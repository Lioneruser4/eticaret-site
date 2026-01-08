const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// MongoDB Connection
const MONGODB_URI = "mongodb+srv://xaliqbtc:xaliq7313@stars.uyzln.mongodb.net/hockey_game?retryWrites=true&w=majority";
mongoose.connect(MONGODB_URI).then(() => console.log("MongoDB Connected")).catch(err => console.log(err));

const userSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    username: String,
    photoUrl: String,
    elo: { type: Number, default: 1000 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    lastLogin: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

let matchmakingQueue = [];
let rooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('auth', async (userData) => {
        if (!userData || !userData.id) return;

        let user = await User.findOne({ userId: userData.id.toString() });
        if (!user) {
            user = new User({
                userId: userData.id.toString(),
                username: userData.first_name || userData.username || 'Anonim',
                photoUrl: userData.photo_url || '',
            });
            await user.save();
        } else {
            user.username = userData.first_name || userData.username || user.username;
            user.photoUrl = userData.photo_url || user.photoUrl;
            user.lastLogin = Date.now();
            await user.save();
        }

        socket.userData = user;
        socket.emit('auth_success', user);
    });

    socket.on('get_leaderboard', async () => {
        const topPlayers = await User.find().sort({ elo: -1 }).limit(10);
        socket.emit('leaderboard_data', topPlayers);
    });

    socket.on('join_matchmaking', () => {
        if (!socket.userData) return;

        // Remove from queue if already in
        matchmakingQueue = matchmakingQueue.filter(s => s.id !== socket.id);

        if (matchmakingQueue.length > 0) {
            const opponent = matchmakingQueue.shift();
            const roomId = `room_${socket.id}_${opponent.id}`;

            socket.join(roomId);
            opponent.join(roomId);

            const gameData = {
                roomId,
                players: [
                    { id: socket.id, side: 'bottom', info: socket.userData },
                    { id: opponent.id, side: 'top', info: opponent.userData }
                ]
            };

            rooms.set(roomId, {
                players: [socket, opponent],
                scores: { top: 0, bottom: 0 },
                state: 'playing'
            });

            io.to(roomId).emit('match_found', gameData);
        } else {
            matchmakingQueue.push(socket);
            socket.emit('waiting_for_opponent');
        }
    });

    socket.on('cancel_matchmaking', () => {
        matchmakingQueue = matchmakingQueue.filter(s => s.id !== socket.id);
    });

    socket.on('create_private_room', () => {
        if (!socket.userData) return;
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.emit('private_room_created', roomCode);
    });

    socket.on('join_private_room', (roomCode) => {
        if (!socket.userData) return;
        const room = io.sockets.adapter.rooms.get(roomCode);

        if (room && room.size === 1) {
            socket.join(roomCode);
            const clients = Array.from(room);
            const opponentId = clients[0];
            const opponent = io.sockets.sockets.get(opponentId);

            const gameData = {
                roomId: roomCode,
                players: [
                    { id: opponent.id, side: 'top', info: opponent.userData },
                    { id: socket.id, side: 'bottom', info: socket.userData }
                ]
            };

            rooms.set(roomCode, {
                players: [opponent, socket],
                scores: { top: 0, bottom: 0 },
                state: 'playing'
            });

            io.to(roomCode).emit('match_found', gameData);
        } else {
            socket.emit('error_message', 'Oda bulunamadı veya dolu.');
        }
    });

    // Game Sync
    socket.on('update_paddle', (data) => {
        // data: { roomId, x, y }
        socket.to(data.roomId).emit('opponent_paddle', { x: data.x, y: data.y });
    });

    socket.on('update_puck', (data) => {
        // Only the bottom player (host of physics or first player) sends puck updates to keep sync
        // Or we can let server handle physics. For simplicity and "uninterrupted" feeling, 
        // client-side master physics with server validation/sync is common for mobile.
        socket.to(data.roomId).emit('puck_sync', data);
    });

    socket.on('goal', async (data) => {
        const room = rooms.get(data.roomId);
        if (!room) return;

        if (data.side === 'top') room.scores.top++;
        else room.scores.bottom++;

        io.to(data.roomId).emit('update_scores', room.scores);

        if (room.scores.top >= 7 || room.scores.bottom >= 7) {
            const winnerSide = room.scores.top >= 7 ? 'top' : 'bottom';
            const winner = room.players.find((p, i) => (winnerSide === 'top' ? i === 0 : i === 1));
            const loser = room.players.find((p, i) => (winnerSide === 'top' ? i === 1 : i === 0));

            if (winner && loser && winner.userData && loser.userData) {
                // Update ELO
                await User.updateOne({ userId: winner.userData.userId }, { $inc: { elo: 25, wins: 1 } });
                await User.updateOne({ userId: loser.userData.userId }, { $inc: { elo: -15, losses: 1 } });
            }

            io.to(data.roomId).emit('game_over', { winner: winnerSide });
            rooms.delete(data.roomId);
        }
    });

    socket.on('disconnect', async () => {
        console.log('User disconnected:', socket.id);
        matchmakingQueue = matchmakingQueue.filter(s => s.id !== socket.id);

        // Handle active game disconnection
        for (const [roomId, room] of rooms.entries()) {
            if (room.players.some(p => p.id === socket.id)) {
                const otherPlayer = room.players.find(p => p.id !== socket.id);
                if (otherPlayer) {
                    otherPlayer.emit('opponent_left');
                    // Penalize the leaver if game was active
                    if (socket.userData) {
                        await User.updateOne({ userId: socket.userData.userId }, { $inc: { elo: -30, losses: 1 } });
                    }
                    if (otherPlayer.userData) {
                        await User.updateOne({ userId: otherPlayer.userData.userId }, { $inc: { elo: 15, wins: 1 } });
                    }
                }
                rooms.delete(roomId);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
