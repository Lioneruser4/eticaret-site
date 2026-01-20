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

// Data persistence (Memory only for now as requested)
const users = new Map(); // socket.id -> { id, name, photo, gender, country, city, username }
const waitingList = []; // Array of socket.ids
const activeChats = new Map(); // socket.id -> { partnerId, roomId }
const revealRequests = new Map(); // roomId -> { id1: bool, id2: bool }

io.on('connection', (socket) => {
    console.log(`[CONN] ${socket.id}`);

    // Update/Register user profile
    socket.on('update_profile', (profile) => {
        users.set(socket.id, { ...profile, socketId: socket.id });
        console.log(`[USER] ${profile.name} (${profile.gender}) joined from ${profile.city || profile.country || 'Global'}`);
    });

    // Matchmaking Request
    socket.on('find_partner', () => {
        const me = users.get(socket.id);
        if (!me) return;

        // Clean up from queue if already there
        const oldIdx = waitingList.indexOf(socket.id);
        if (oldIdx > -1) waitingList.splice(oldIdx, 1);

        // Try to find a match
        const partnerId = waitingList.find(id => {
            const p = users.get(id);
            if (!p) return false;
            if (id === socket.id) return false;

            // STRIKT FILTRELEME (İsteğe bağlı): 
            // Eğer şehir/ülke seçilmişse sadece oradan olanlarla eşleştir.
            // "Azerbaycana dokundukda Bakı sumqayıt Xırdalan yazsın... o şehirler"
            if (me.country && p.country && me.country !== p.country) return false;
            if (me.city && p.city && me.city !== p.city) return false;

            // Cinsiyet Karşılaştırması (Opsiyonel: Farklı cinsiyet aramayı tercih edebiliriz)
            // if (me.gender === p.gender) return false; 

            return true;
        });

        if (partnerId) {
            // Match found!
            const partnerIdx = waitingList.indexOf(partnerId);
            waitingList.splice(partnerIdx, 1);

            const roomId = `room_${socket.id}_${partnerId}`;
            const partnerSocket = io.sockets.sockets.get(partnerId);

            if (partnerSocket) {
                socket.join(roomId);
                partnerSocket.join(roomId);

                activeChats.set(socket.id, { partnerId, roomId });
                activeChats.set(partnerId, { partnerId: socket.id, roomId });
                revealRequests.set(roomId, { [socket.id]: false, [partnerId]: false });

                socket.emit('match_found');
                partnerSocket.emit('match_found');
                console.log(`[MATCH] ${socket.id} <-> ${partnerId}`);
            } else {
                // Partner disconnected, retry
                socket.emit('searching');
                waitingList.push(socket.id);
            }
        } else {
            // No match found, add to waiting list
            waitingList.push(socket.id);
            socket.emit('searching');
            console.log(`[QUEUED] ${socket.id}. Queue size: ${waitingList.length}`);
        }
    });

    socket.on('stop_searching', () => {
        const idx = waitingList.indexOf(socket.id);
        if (idx > -1) waitingList.splice(idx, 1);
    });

    // Messaging
    socket.on('chat_message', (msg) => {
        const myChat = activeChats.get(socket.id);
        if (myChat) {
            io.to(myChat.roomId).emit('chat_message', {
                senderId: socket.id,
                text: msg,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }
    });

    // Profile Disclosure (Eşleşdik sistemi)
    socket.on('request_reveal', () => {
        const myChat = activeChats.get(socket.id);
        if (!myChat) return;

        const status = revealRequests.get(myChat.roomId);
        if (!status) return;

        status[socket.id] = true;
        const partnerId = myChat.partnerId;

        if (status[partnerId]) {
            // Both reveal!
            io.to(myChat.roomId).emit('profiles_revealed', {
                [socket.id]: users.get(socket.id),
                [partnerId]: users.get(partnerId)
            });
        } else {
            // One requested
            socket.emit('reveal_sent');
            io.to(partnerId).emit('partner_wants_reveal');
        }
    });

    // Next/Exit
    socket.on('next_partner', () => {
        disconnectPartner(socket);
        // Automatically find new
        socket.emit('start_new_search');
    });

    const disconnectPartner = (sock) => {
        const myChat = activeChats.get(sock.id);
        if (myChat) {
            const pId = myChat.partnerId;
            const rId = myChat.roomId;

            io.to(pId).emit('partner_left');

            const pSock = io.sockets.sockets.get(pId);
            if (pSock) pSock.leave(rId);
            sock.leave(rId);

            activeChats.delete(sock.id);
            activeChats.delete(pId);
            revealRequests.delete(rId);
        }
        // Always remove from waiting list on any exit
        const idx = waitingList.indexOf(sock.id);
        if (idx > -1) waitingList.splice(idx, 1);
    };

    socket.on('disconnect', () => {
        disconnectPartner(socket);
        users.delete(socket.id);
        console.log(`[DISC] ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
