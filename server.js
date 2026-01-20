const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// User data store
const users = new Map();
const waitingQueue = [];
const activeChats = new Map(); // socket.id -> { partnerId, roomId }
const revealStatus = new Map(); // roomId -> { user1Id: bool, user2Id: bool }

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_lobby', (userData) => {
        // userData: { id, name, photo, gender, country, city, username }
        users.set(socket.id, { ...userData, socketId: socket.id });
        findMatch(socket);
    });

    const findMatch = (socket) => {
        const currentUser = users.get(socket.id);
        if (!currentUser) return;

        // Try to find a match in the waiting queue
        const partnerIndex = waitingQueue.findIndex(id => {
            const partner = users.get(id);
            if (!partner) return false;
            // Basic filtering: Country/City if enabled, but for random chat we might just match anyone first
            // but let's honor the country/city selection if they matched.
            if (currentUser.id === partner.id) return false; // Don't match with self

            // Gender match (Optional logic: can be stricter, but usually for random chat we try to find anyone)
            // But let's check if they specified a preference or just their own gender.
            // The user said: "kız erkek seçimi siteye girerken sadece bir kez seçsin".
            // I'll match them with someone of the opposite gender or same, based on common practice.
            // For now, let's just match based on Location if selected.

            if (currentUser.country && partner.country && currentUser.country !== partner.country) return false;
            if (currentUser.city && partner.city && currentUser.city !== partner.city) return false;

            return true;
        });

        if (partnerIndex !== -1) {
            const partnerId = waitingQueue.splice(partnerIndex, 1)[0];
            const partnerSocket = io.sockets.sockets.get(partnerId);

            if (partnerSocket) {
                const roomId = `room_${socket.id}_${partnerId}`;
                socket.join(roomId);
                partnerSocket.join(roomId);

                activeChats.set(socket.id, { partnerId, roomId });
                activeChats.set(partnerId, { partnerId: socket.id, roomId });

                revealStatus.set(roomId, {
                    [socket.id]: false,
                    [partnerId]: false
                });

                socket.emit('match_found', { partnerId: partnerId, anonymous: true });
                partnerSocket.emit('match_found', { partnerId: socket.id, anonymous: true });
            } else {
                // Partner disconnected while waiting
                findMatch(socket);
            }
        } else {
            if (!waitingQueue.includes(socket.id)) {
                waitingQueue.push(socket.id);
            }
            socket.emit('waiting_for_match');
        }
    };

    socket.on('send_message', (data) => {
        const chat = activeChats.get(socket.id);
        if (chat) {
            io.to(chat.roomId).emit('new_message', {
                senderId: socket.id,
                text: data.text,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }
    });

    socket.on('request_reveal', () => {
        const chat = activeChats.get(socket.id);
        if (!chat) return;

        const status = revealStatus.get(chat.roomId);
        if (!status) return;

        status[socket.id] = true;

        const partnerId = chat.partnerId;
        if (status[partnerId]) {
            // Both revealed!
            const user1 = users.get(socket.id);
            const user2 = users.get(partnerId);

            io.to(chat.roomId).emit('profiles_revealed', {
                [socket.id]: user1,
                [partnerId]: user2
            });
        } else {
            // Only one requested, notify the other
            io.to(partnerId).emit('reveal_requested_by_partner');
            socket.emit('reveal_request_sent');
        }
    });

    socket.on('next_match', () => {
        handleDisconnectFromPartner(socket);
        findMatch(socket);
    });

    socket.on('leave_chat', () => {
        handleDisconnectFromPartner(socket);
        socket.emit('back_to_lobby');
    });

    const handleDisconnectFromPartner = (sock) => {
        const chat = activeChats.get(sock.id);
        if (chat) {
            const partnerId = chat.partnerId;
            const roomId = chat.roomId;

            io.to(partnerId).emit('partner_left');

            const partnerSocket = io.sockets.sockets.get(partnerId);
            if (partnerSocket) {
                partnerSocket.leave(roomId);
            }
            sock.leave(roomId);

            activeChats.delete(sock.id);
            activeChats.delete(partnerId);
            revealStatus.delete(roomId);
        }

        // Remove from queue
        const qIdx = waitingQueue.indexOf(sock.id);
        if (qIdx !== -1) waitingQueue.splice(qIdx, 1);
    };

    socket.on('disconnect', () => {
        handleDisconnectFromPartner(socket);
        users.delete(socket.id);
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
