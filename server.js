const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Data stores
const users = new Map(); // socket.id -> profile
const queues = {
    'az': [],
    'tr': [],
    'ru': [],
    'us': []
};
const activeChats = new Map(); // socket.id -> { partnerId, roomId }
const revealStatus = new Map(); // roomId -> { id1: bool, id2: bool }

// Track online stats
let onlineCount = 0;

io.on('connection', (socket) => {
    onlineCount++;
    console.log(`[+] User connected: ${socket.id} (Online: ${onlineCount})`);
    io.emit('online_stats', { count: onlineCount });

    socket.on('register_user', (profile) => {
        users.set(socket.id, { ...profile, socketId: socket.id });
        console.log(`[REG] Profile registered for ${socket.id}: ${profile.name}`);
    });

    socket.on('start_matchmaking', (region) => {
        console.log(`[TRY] ${socket.id} looking for match in ${region}`);

        // Safety check - remove from any existing queues
        Object.keys(queues).forEach(r => {
            queues[r] = queues[r].filter(id => id !== socket.id);
        });

        // 1. Try to find a valid partner in the same region
        let partnerId = null;
        while (queues[region].length > 0) {
            const potentialPartnerId = queues[region].shift();
            // Check if partner is still connected
            if (io.sockets.sockets.has(potentialPartnerId) && potentialPartnerId !== socket.id) {
                partnerId = potentialPartnerId;
                break;
            }
        }

        if (partnerId) {
            // Match success!
            const partnerSocket = io.sockets.sockets.get(partnerId);
            const roomId = `room_${socket.id}_${partnerId}`;

            socket.join(roomId);
            partnerSocket.join(roomId);

            activeChats.set(socket.id, { partnerId, roomId });
            activeChats.set(partnerId, { partnerId: socket.id, roomId });
            revealStatus.set(roomId, { [socket.id]: false, [partnerId]: false });

            io.to(roomId).emit('match_found');
            console.log(`[MATCH] Success: ${socket.id} <-> ${partnerId} (Region: ${region})`);
        } else {
            // No partner, add self to queue
            queues[region].push(socket.id);
            socket.emit('waiting');
            console.log(`[QUEUE] ${socket.id} is now waiting in ${region}`);
        }
    });

    socket.on('stop_matchmaking', () => {
        Object.keys(queues).forEach(r => {
            queues[r] = queues[r].filter(id => id !== socket.id);
        });
        console.log(`[STOP] ${socket.id} stopped searching`);
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
        console.log(`[NEXT] ${socket.id} looking for someone new`);
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

            io.to(pId).emit('partner_left');

            const pSock = io.sockets.sockets.get(pId);
            if (pSock) pSock.leave(rId);
            sock.leave(rId);

            activeChats.delete(sock.id);
            activeChats.delete(pId);
            revealStatus.delete(rId);
        }

        // Cleanup queues
        Object.keys(queues).forEach(r => {
            queues[r] = queues[r].filter(id => id !== sock.id);
        });
    };

    socket.on('disconnect', () => {
        handleDisconnect(socket);
        users.delete(socket.id);
        onlineCount--;
        io.emit('online_stats', { count: Math.max(0, onlineCount) });
        console.log(`[-] User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server live on port ${PORT}`);
});
