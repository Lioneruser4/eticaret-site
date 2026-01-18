const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, '..')));

// Game state
const players = new Map();
const rooms = new Map();
const games = new Map();

// Constants
const ROLES = {
    CREWMATE: 'crewmate',
    IMPOSTER: 'imposter',
    POLICE: 'police'
};

const GAME_STATES = {
    WAITING: 'waiting',
    STARTING: 'starting',
    PLAYING: 'playing',
    MEETING: 'meeting',
    ENDED: 'ended'
};

// Helper functions
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function broadcast(ws, type, payload) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

function broadcastToRoom(roomCode, type, payload, excludePlayerId = null) {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.players.forEach(playerId => {
        if (playerId !== excludePlayerId) {
            const player = players.get(playerId);
            if (player && player.ws) {
                broadcast(player.ws, type, payload);
            }
        }
    });
}

function getRoomData(room) {
    const playerData = room.players.map(playerId => {
        const player = players.get(playerId);
        return {
            id: player.id,
            username: player.username,
            avatar: player.avatar,
            ready: player.ready,
            isHost: player.id === room.host
        };
    });

    return {
        code: room.code,
        name: room.name,
        host: room.host,
        currentPlayers: room.players.length,
        maxPlayers: room.settings.maxPlayers,
        hasPassword: !!room.password,
        settings: room.settings,
        players: playerData,
        state: room.state
    };
}

function getRoomList() {
    const roomList = [];
    rooms.forEach(room => {
        if (room.state === GAME_STATES.WAITING) {
            roomList.push({
                code: room.code,
                name: room.name,
                currentPlayers: room.players.length,
                maxPlayers: room.settings.maxPlayers,
                hasPassword: !!room.password,
                imposterCount: room.settings.imposterCount,
                policeCount: room.settings.policeCount,
                taskCount: room.settings.taskCount
            });
        }
    });
    return roomList;
}

function assignRoles(room) {
    const playerIds = [...room.players];
    const roles = new Map();

    // Shuffle players
    for (let i = playerIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
    }

    let index = 0;

    // Assign imposters
    for (let i = 0; i < room.settings.imposterCount; i++) {
        roles.set(playerIds[index], ROLES.IMPOSTER);
        index++;
    }

    // Assign police
    for (let i = 0; i < room.settings.policeCount; i++) {
        roles.set(playerIds[index], ROLES.POLICE);
        index++;
    }

    // Assign crewmates to remaining players
    while (index < playerIds.length) {
        roles.set(playerIds[index], ROLES.CREWMATE);
        index++;
    }

    return roles;
}

function startGame(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.state = GAME_STATES.PLAYING;

    // Assign roles
    const roles = assignRoles(room);

    // Create game state
    const game = {
        roomCode: roomCode,
        state: GAME_STATES.PLAYING,
        roles: roles,
        alivePlayers: new Set(room.players),
        deadBodies: new Map(),
        completedTasks: new Map(),
        totalTasks: room.settings.taskCount * room.players.filter(id =>
            roles.get(id) !== ROLES.IMPOSTER
        ).length,
        completedTaskCount: 0,
        meetingCount: 0,
        votes: new Map()
    };

    games.set(roomCode, game);

    // Notify players
    room.players.forEach(playerId => {
        const player = players.get(playerId);
        const role = roles.get(playerId);

        const gameData = {
            role: role,
            tasks: role !== ROLES.IMPOSTER ? generateTasks(room.settings.taskCount) : [],
            emergencyMeetings: room.settings.emergencyMeetings,
            players: room.players.map(pid => {
                const p = players.get(pid);
                return {
                    id: p.id,
                    username: p.username,
                    avatar: p.avatar,
                    color: getPlayerColor(room.players.indexOf(pid))
                };
            })
        };

        broadcast(player.ws, 'game_started', gameData);
        broadcast(player.ws, 'role_assigned', { role: role });
    });
}

function generateTasks(count) {
    const taskTypes = ['wiring', 'download', 'fuel', 'garbage', 'scan', 'asteroids', 'shields', 'reactor'];
    const tasks = [];

    for (let i = 0; i < count; i++) {
        tasks.push({
            id: `task_${i}`,
            type: taskTypes[i % taskTypes.length],
            completed: false
        });
    }

    return tasks;
}

function getPlayerColor(index) {
    const colors = [
        '#ff0000', '#0000ff', '#00ff00', '#ff00ff', '#ffa500',
        '#ffff00', '#000000', '#ffffff', '#800080', '#00ffff'
    ];
    return colors[index % colors.length];
}

function checkGameEnd(roomCode) {
    const game = games.get(roomCode);
    const room = rooms.get(roomCode);
    if (!game || !room) return;

    const aliveImposters = Array.from(game.alivePlayers).filter(id =>
        game.roles.get(id) === ROLES.IMPOSTER
    ).length;

    const aliveCrewmates = Array.from(game.alivePlayers).filter(id =>
        game.roles.get(id) !== ROLES.IMPOSTER
    ).length;

    let winner = null;
    let reason = '';

    // Imposters win if equal or more than crewmates
    if (aliveImposters >= aliveCrewmates) {
        winner = 'imposters';
        reason = 'İmposterler crewmate sayısına ulaştı!';
    }
    // Crewmates win if all imposters dead
    else if (aliveImposters === 0) {
        winner = 'crewmates';
        reason = 'Tüm imposterler elendirildi!';
    }
    // Crewmates win if all tasks completed
    else if (game.completedTaskCount >= game.totalTasks) {
        winner = 'crewmates';
        reason = 'Tüm görevler tamamlandı!';
    }

    if (winner) {
        endGame(roomCode, winner, reason);
    }
}

function endGame(roomCode, winner, reason) {
    const game = games.get(roomCode);
    const room = rooms.get(roomCode);
    if (!game || !room) return;

    game.state = GAME_STATES.ENDED;
    room.state = GAME_STATES.ENDED;

    const winners = room.players.filter(playerId => {
        const role = game.roles.get(playerId);
        return (winner === 'imposters' && role === ROLES.IMPOSTER) ||
            (winner === 'crewmates' && role !== ROLES.IMPOSTER);
    }).map(playerId => {
        const player = players.get(playerId);
        return {
            id: player.id,
            username: player.username,
            avatar: player.avatar,
            role: game.roles.get(playerId)
        };
    });

    broadcastToRoom(roomCode, 'game_ended', {
        winner: winner,
        reason: reason,
        winners: winners
    });

    // Clean up
    games.delete(roomCode);
    rooms.delete(roomCode);
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New client connected');

    let playerId = null;

    ws.on('message', (message) => {
        try {
            const { type, payload } = JSON.parse(message);

            switch (type) {
                case 'auth':
                    playerId = payload.userId.toString();
                    players.set(playerId, {
                        id: playerId,
                        username: payload.username,
                        avatar: payload.avatar,
                        isGuest: payload.isGuest,
                        ws: ws,
                        roomCode: null,
                        ready: false
                    });

                    broadcast(ws, 'auth_success', { playerId: playerId });

                    // Send online count
                    broadcastOnlineCount();
                    break;

                case 'get_rooms':
                    broadcast(ws, 'room_list', { rooms: getRoomList() });
                    break;

                case 'create_room':
                    const roomCode = generateRoomCode();
                    const room = {
                        code: roomCode,
                        name: payload.name,
                        password: payload.password,
                        host: playerId,
                        players: [playerId],
                        settings: {
                            maxPlayers: payload.maxPlayers,
                            imposterCount: payload.imposterCount,
                            policeCount: payload.policeCount,
                            taskCount: payload.taskCount,
                            emergencyMeetings: payload.emergencyMeetings,
                            discussionTime: payload.discussionTime,
                            votingTime: payload.votingTime
                        },
                        state: GAME_STATES.WAITING
                    };

                    rooms.set(roomCode, room);

                    const player = players.get(playerId);
                    player.roomCode = roomCode;

                    broadcast(ws, 'room_created', { room: getRoomData(room) });
                    break;

                case 'join_room':
                    const targetRoom = rooms.get(payload.roomCode);

                    if (!targetRoom) {
                        broadcast(ws, 'error', { message: 'Oda bulunamadı!' });
                        break;
                    }

                    if (targetRoom.password && targetRoom.password !== payload.password) {
                        broadcast(ws, 'error', { message: 'Yanlış şifre!' });
                        break;
                    }

                    if (targetRoom.players.length >= targetRoom.settings.maxPlayers) {
                        broadcast(ws, 'error', { message: 'Oda dolu!' });
                        break;
                    }

                    targetRoom.players.push(playerId);
                    const joiningPlayer = players.get(playerId);
                    joiningPlayer.roomCode = payload.roomCode;

                    broadcast(ws, 'room_joined', { room: getRoomData(targetRoom) });
                    broadcastToRoom(payload.roomCode, 'room_updated', { room: getRoomData(targetRoom) });
                    broadcastToRoom(payload.roomCode, 'player_joined', {
                        playerId: playerId,
                        username: joiningPlayer.username
                    });
                    break;

                case 'leave_room':
                    const currentPlayer = players.get(playerId);
                    if (currentPlayer && currentPlayer.roomCode) {
                        const currentRoom = rooms.get(currentPlayer.roomCode);
                        if (currentRoom) {
                            currentRoom.players = currentRoom.players.filter(id => id !== playerId);

                            if (currentRoom.players.length === 0) {
                                rooms.delete(currentPlayer.roomCode);
                            } else {
                                if (currentRoom.host === playerId) {
                                    currentRoom.host = currentRoom.players[0];
                                }
                                broadcastToRoom(currentPlayer.roomCode, 'room_updated', {
                                    room: getRoomData(currentRoom)
                                });
                                broadcastToRoom(currentPlayer.roomCode, 'player_left', {
                                    playerId: playerId
                                });
                            }
                        }
                        currentPlayer.roomCode = null;
                        currentPlayer.ready = false;
                    }
                    break;

                case 'set_ready':
                    const readyPlayer = players.get(playerId);
                    if (readyPlayer && readyPlayer.roomCode) {
                        readyPlayer.ready = payload.ready;
                        const readyRoom = rooms.get(readyPlayer.roomCode);
                        if (readyRoom) {
                            broadcastToRoom(readyPlayer.roomCode, 'room_updated', {
                                room: getRoomData(readyRoom)
                            });
                        }
                    }
                    break;

                case 'start_game':
                    const hostPlayer = players.get(playerId);
                    if (hostPlayer && hostPlayer.roomCode) {
                        const hostRoom = rooms.get(hostPlayer.roomCode);
                        if (hostRoom && hostRoom.host === playerId) {
                            broadcastToRoom(hostPlayer.roomCode, 'game_starting', { countdown: 3 });
                            setTimeout(() => {
                                startGame(hostPlayer.roomCode);
                            }, 3000);
                        }
                    }
                    break;

                case 'move_player':
                    const movingPlayer = players.get(playerId);
                    if (movingPlayer && movingPlayer.roomCode) {
                        broadcastToRoom(movingPlayer.roomCode, 'player_moved', {
                            playerId: playerId,
                            position: payload.position,
                            rotation: payload.rotation
                        }, playerId);
                    }
                    break;

                case 'kill_player':
                    const killerPlayer = players.get(playerId);
                    if (killerPlayer && killerPlayer.roomCode) {
                        const killerGame = games.get(killerPlayer.roomCode);
                        if (killerGame && killerGame.roles.get(playerId) === ROLES.IMPOSTER) {
                            killerGame.alivePlayers.delete(payload.targetId);
                            killerGame.deadBodies.set(payload.targetId, Date.now());

                            broadcastToRoom(killerPlayer.roomCode, 'player_killed', {
                                killerId: playerId,
                                victimId: payload.targetId
                            });

                            checkGameEnd(killerPlayer.roomCode);
                        }
                    }
                    break;

                case 'report_body':
                    const reporterPlayer = players.get(playerId);
                    if (reporterPlayer && reporterPlayer.roomCode) {
                        startMeeting(reporterPlayer.roomCode, 'body', playerId, payload.bodyId);
                    }
                    break;

                case 'call_emergency':
                    const callerPlayer = players.get(playerId);
                    if (callerPlayer && callerPlayer.roomCode) {
                        startMeeting(callerPlayer.roomCode, 'emergency', playerId);
                    }
                    break;

                case 'chat_message':
                    const chattingPlayer = players.get(playerId);
                    if (chattingPlayer && chattingPlayer.roomCode) {
                        broadcastToRoom(chattingPlayer.roomCode, 'chat_message', {
                            playerId: playerId,
                            username: chattingPlayer.username,
                            message: payload.message
                        });
                    }
                    break;

                case 'cast_vote':
                    const votingPlayer = players.get(playerId);
                    if (votingPlayer && votingPlayer.roomCode) {
                        const votingGame = games.get(votingPlayer.roomCode);
                        if (votingGame) {
                            votingGame.votes.set(playerId, payload.targetId);
                            broadcastToRoom(votingPlayer.roomCode, 'vote_cast', {
                                voterId: playerId
                            });
                        }
                    }
                    break;

                case 'complete_task':
                    const taskPlayer = players.get(playerId);
                    if (taskPlayer && taskPlayer.roomCode) {
                        const taskGame = games.get(taskPlayer.roomCode);
                        if (taskGame) {
                            taskGame.completedTaskCount++;
                            broadcastToRoom(taskPlayer.roomCode, 'task_completed', {
                                playerId: playerId,
                                taskId: payload.taskId,
                                totalCompleted: taskGame.completedTaskCount,
                                totalTasks: taskGame.totalTasks
                            });

                            checkGameEnd(taskPlayer.roomCode);
                        }
                    }
                    break;

                case 'trigger_sabotage':
                    const sabotagePlayer = players.get(playerId);
                    if (sabotagePlayer && sabotagePlayer.roomCode) {
                        broadcastToRoom(sabotagePlayer.roomCode, 'sabotage_triggered', {
                            type: payload.sabotageType,
                            playerId: playerId
                        });
                    }
                    break;
            }

        } catch (error) {
            console.error('Error handling message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');

        if (playerId) {
            const player = players.get(playerId);
            if (player && player.roomCode) {
                const room = rooms.get(player.roomCode);
                if (room) {
                    room.players = room.players.filter(id => id !== playerId);

                    if (room.players.length === 0) {
                        rooms.delete(player.roomCode);
                    } else {
                        if (room.host === playerId) {
                            room.host = room.players[0];
                        }
                        broadcastToRoom(player.roomCode, 'room_updated', {
                            room: getRoomData(room)
                        });
                        broadcastToRoom(player.roomCode, 'player_left', { playerId });
                    }
                }
            }

            players.delete(playerId);
            broadcastOnlineCount();
        }
    });
});

function startMeeting(roomCode, type, callerId, bodyId = null) {
    const room = rooms.get(roomCode);
    const game = games.get(roomCode);
    if (!room || !game) return;

    game.state = GAME_STATES.MEETING;
    game.votes.clear();

    const meetingData = {
        type: type,
        caller: players.get(callerId).username,
        reporter: type === 'body' ? players.get(callerId).username : null,
        bodyId: bodyId,
        discussionTime: room.settings.discussionTime,
        votingTime: room.settings.votingTime,
        players: room.players.map(playerId => {
            const player = players.get(playerId);
            return {
                id: player.id,
                username: player.username,
                avatar: player.avatar,
                isDead: !game.alivePlayers.has(playerId),
                voteCount: 0
            };
        })
    };

    broadcastToRoom(roomCode, 'meeting_started', meetingData);

    // Auto-end meeting after time
    setTimeout(() => {
        endMeeting(roomCode);
    }, (room.settings.discussionTime + room.settings.votingTime) * 1000);
}

function endMeeting(roomCode) {
    const game = games.get(roomCode);
    const room = rooms.get(roomCode);
    if (!game || !room) return;

    // Count votes
    const voteCounts = new Map();
    game.votes.forEach((targetId, voterId) => {
        if (targetId) {
            voteCounts.set(targetId, (voteCounts.get(targetId) || 0) + 1);
        }
    });

    // Find player with most votes
    let ejectedId = null;
    let maxVotes = 0;
    let tie = false;

    voteCounts.forEach((count, playerId) => {
        if (count > maxVotes) {
            maxVotes = count;
            ejectedId = playerId;
            tie = false;
        } else if (count === maxVotes) {
            tie = true;
        }
    });

    let result = {};

    if (tie || !ejectedId) {
        result = { ejected: null };
    } else {
        const ejectedPlayer = players.get(ejectedId);
        const wasImposter = game.roles.get(ejectedId) === ROLES.IMPOSTER;

        game.alivePlayers.delete(ejectedId);

        result = {
            ejected: {
                id: ejectedId,
                username: ejectedPlayer.username,
                avatar: ejectedPlayer.avatar
            },
            wasImposter: wasImposter
        };
    }

    broadcastToRoom(roomCode, 'voting_ended', result);

    game.state = GAME_STATES.PLAYING;

    checkGameEnd(roomCode);
}

function broadcastOnlineCount() {
    const count = players.size;
    players.forEach(player => {
        broadcast(player.ws, 'online_count', { count });
    });
}

// HTTP routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket server ready`);
});
