// Configuration
const CONFIG = {
    // Server URL - Render üzerinde deploy edilecek
    SERVER_URL: 'https://saskioyunu.onrender.com',
    WS_URL: 'wss://saskioyunu.onrender.com',
    
    // Game Settings
    GAME: {
        MIN_PLAYERS: 4,
        MAX_PLAYERS: 10,
        MIN_IMPOSTERS: 1,
        MAX_IMPOSTERS: 3,
        MIN_POLICE: 0,
        MAX_POLICE: 2,
        PLAYER_SPEED: 5,
        KILL_COOLDOWN: 30000, // 30 seconds
        KILL_DISTANCE: 2,
        REPORT_DISTANCE: 2,
        TASK_INTERACTION_DISTANCE: 1.5,
        EMERGENCY_COOLDOWN: 20000, // 20 seconds
    },
    
    // Map Settings
    MAP: {
        WIDTH: 50,
        HEIGHT: 50,
        SPAWN_POINTS: [
            { x: 25, y: 25, z: 0 }
        ]
    },
    
    // Colors for players
    COLORS: [
        '#ff0000', // Red
        '#0000ff', // Blue
        '#00ff00', // Green
        '#ff00ff', // Pink
        '#ffa500', // Orange
        '#ffff00', // Yellow
        '#000000', // Black
        '#ffffff', // White
        '#800080', // Purple
        '#00ffff', // Cyan
    ],
    
    // Roles
    ROLES: {
        CREWMATE: 'crewmate',
        IMPOSTER: 'imposter',
        POLICE: 'police'
    },
    
    // Task Types
    TASKS: {
        WIRING: 'wiring',
        DOWNLOAD: 'download',
        FUEL: 'fuel',
        GARBAGE: 'garbage',
        SCAN: 'scan',
        ASTEROIDS: 'asteroids',
        SHIELDS: 'shields',
        REACTOR: 'reactor'
    }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
