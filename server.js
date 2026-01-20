const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Data persistence
const users = new Map(); // socket.id -> profile
const queues = {
    'az': [],
    'tr': [],
    'ru': [],
    'us': []
};
const activeChats = new Map(); // socket.id -> { partnerId, roomId }
const revealStatus = new Map(); // roomId -> { id1: bool, id2: bool }

io.on('connection', (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    socket.on('register_user', (profile) => {
        users.set(socket.id, { ...profile, socketId: socket.id });
    });

    socket.on('start_matchmaking', (region) => {
        const user = users.get(socket.id);
        if (!user || !queues[region]) return;

        // Clean up from all queues first
        Object.keys(queues).forEach(r => {
            const idx = queues[r].indexOf(socket.id);
            if (idx > -1) queues[r].splice(idx, 1);
        });

        // Try to find a partner
        if (queues[region].length > 0) {
            const partnerId = queues[region].shift();
            const partnerSocket = io.sockets.sockets.get(partnerId);

            if (partnerSocket && partnerSocket.id !== socket.id) {
                const roomId = `room_${socket.id}_${partnerId}`;
                socket.join(roomId);
                partnerSocket.join(roomId);

                activeChats.set(socket.id, { partnerId, roomId });
                activeChats.set(partnerId, { partnerId: socket.id, roomId });
                revealStatus.set(roomId, { [socket.id]: false, [partnerId]: false });

                io.to(roomId).emit('match_found');
                console.log(`[Match] ${socket.id} & ${partnerId} in ${region}`);
            } else {
                // Partner gone or self, try again or add to queue
                queues[region].push(socket.id);
                socket.emit('waiting');
            }
        } else {
            // Queue empty, add self
            queues[region].push(socket.id);
            socket.emit('waiting');
            console.log(`[Queue] ${socket.id} added to ${region}`);
        }
    });

    socket.on('stop_matchmaking', () => {
        Object.keys(queues).forEach(r => {
            const idx = queues[r].indexOf(socket.id);
            if (idx > -1) queues[r].splice(idx, 1);
        });
    });

    socket.on('send_msg', (text) => {
        const chat = activeChats.get(socket.id);
        if (chat) {
            io.to(chat.roomId).emit('new_msg', {
                senderId: socket.id,
                text,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }
    });

    socket.on('request_reveal', () => {
        const chat = activeChats.get(socket.id);
        if (!chat) return;

        const status = revealStatus.get(chat.roomId);
        if (status) {
            status[socket.id] = true;
            if (status[chat.partnerId]) {
                io.to(chat.roomId).emit('revealed', {
                    [socket.id]: users.get(socket.id),
                    [chat.partnerId]: users.get(chat.partnerId)
                });
            } else {
                io.to(chat.partnerId).emit('reveal_request');
                socket.emit('reveal_wait');
            }
        }
    });

    socket.on('next_user', () => {
        handleDisconnect(socket);
        socket.emit('ready_for_next');
    });

    socket.on('leave_chat', () => {
        handleDisconnect(socket);
        socket.emit('to_lobby');
    });

    const handleDisconnect = (sock) => {
        const chat = activeChats.get(sock.id);
        if (chat) {
            const pId = chat.partnerId;
            const rId = chat.roomId;

            io.to(pId).emit('partner_left'); // Notify partner

            const pSock = io.sockets.sockets.get(pId);
            if (pSock) pSock.leave(rId);
            sock.leave(rId);

            activeChats.delete(sock.id);
            activeChats.delete(pId);
            revealStatus.delete(rId);
        }
        // Remove from all queues
        Object.keys(queues).forEach(r => {
            const idx = queues[r].indexOf(sock.id);
            if (idx > -1) queues[r].splice(idx, 1);
        });
    };

    socket.on('disconnect', () => {
        handleDisconnect(socket);
        users.delete(socket.id);
        console.log(`[-] Disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server live on ${PORT}`);
});
