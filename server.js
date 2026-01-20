const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Use a more relaxed CORS for Render/Mobile/External connections
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    allowEIO3: true,
    pingTimeout: 30000,
    pingInterval: 10000
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// State
const users = new Map(); // socketId -> data
const queues = { az: [], tr: [], ru: [], us: [] };
const activeRooms = new Map(); // socketId -> roomInfo
const revealStatus = new Map(); // roomId -> { id1: bool, id2: bool }

let globalOnlineCount = 0;

io.on('connection', (socket) => {
    globalOnlineCount++;
    console.log(`[+] User Joined: ${socket.id} | Total: ${globalOnlineCount}`);

    // Immediate sync of online count
    io.emit('stats_update', { online: globalOnlineCount });

    socket.on('register_me', (userData) => {
        users.set(socket.id, { ...userData, socketId: socket.id });
        console.log(`[USER] Registered: ${userData.name} from ID: ${userData.id}`);
    });

    socket.on('start_match', (region) => {
        console.log(`[MATCH_REQ] ${socket.id} in ${region}`);

        // Remove from all queues first to avoid duplicates
        Object.keys(queues).forEach(r => {
            queues[r] = queues[r].filter(id => id !== socket.id);
        });

        const targetQueue = queues[region];
        if (!targetQueue) return;

        // Try matching
        let partnerId = null;
        while (targetQueue.length > 0) {
            const pid = targetQueue.shift();
            if (io.sockets.sockets.has(pid) && pid !== socket.id) {
                partnerId = pid;
                break;
            }
        }

        if (partnerId) {
            const partnerSocket = io.sockets.sockets.get(partnerId);
            const roomId = `room_${socket.id}_${partnerId}`;

            socket.join(roomId);
            partnerSocket.join(roomId);

            activeRooms.set(socket.id, { partnerId, roomId });
            activeRooms.set(partnerId, { partnerId: socket.id, roomId });
            revealStatus.set(roomId, { [socket.id]: false, [partnerId]: false });

            io.to(roomId).emit('match_found');
            console.log(`[SUCCESS] Room Created: ${roomId}`);
        } else {
            targetQueue.push(socket.id);
            socket.emit('waiting_in_queue');
            console.log(`[QUEUED] ${socket.id} at ${region}`);
        }
    });

    socket.on('stop_match', () => {
        Object.keys(queues).forEach(r => {
            queues[r] = queues[r].filter(id => id !== socket.id);
        });
    });

    socket.on('send_msg', (txt) => {
        const room = activeRooms.get(socket.id);
        if (room) {
            io.to(room.roomId).emit('msg_receive', {
                senderId: socket.id,
                text: txt,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }
    });

    socket.on('reveal_request', () => {
        const room = activeRooms.get(socket.id);
        if (!room) return;
        const status = revealStatus.get(room.roomId);
        if (!status) return;

        status[socket.id] = true;
        if (status[room.partnerId]) {
            io.to(room.roomId).emit('reveal_all', {
                [socket.id]: users.get(socket.id),
                [room.partnerId]: users.get(room.partnerId)
            });
        } else {
            io.to(room.partnerId).emit('reveal_notifier');
            socket.emit('reveal_wait_status');
        }
    });

    socket.on('next_please', () => {
        cleanupRoom(socket);
        socket.emit('trigger_new_search');
    });

    socket.on('exit_chat', () => {
        cleanupRoom(socket);
        socket.emit('go_to_lobby');
    });

    const cleanupRoom = (sock) => {
        const room = activeRooms.get(sock.id);
        if (room) {
            const pId = room.partnerId;
            const rId = room.roomId;
            io.to(pId).emit('partner_left_room');

            const pSock = io.sockets.sockets.get(pId);
            if (pSock) pSock.leave(rId);
            sock.leave(rId);

            activeRooms.delete(sock.id);
            activeRooms.delete(pId);
            revealStatus.delete(rId);
        }
        Object.keys(queues).forEach(r => {
            queues[r] = queues[r].filter(id => id !== sock.id);
        });
    };

    socket.on('disconnect', () => {
        cleanupRoom(socket);
        users.delete(socket.id);
        globalOnlineCount = Math.max(0, globalOnlineCount - 1);
        io.emit('stats_update', { online: globalOnlineCount });
        console.log(`[-] User Left: ${socket.id} | Remaining: ${globalOnlineCount}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on Port: ${PORT}`);
});
