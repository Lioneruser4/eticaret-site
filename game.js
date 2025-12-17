/**
 * HIDE & SEEK 3D - GAME ENGINE
 * Professional 3D Multiplayer Hide and Seek
 */

// --- Configuration ---
const CONFIG = {
    // Otomatik Sunucu Seçimi (Eğer yerelde çalışıyorsan localhost'a bağlanır)
    SERVER_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'
        : 'https://saskioyunu.onrender.com',
    MAZE_SIZE: 30,
    PLAYER_SPEED: 0.15,
    LOOK_SENSITIVITY: 0.002,
    DEFAULT_TIMER: 300
};

// --- Variables ---
let socket;
let currentUser = { id: 'guest_' + Math.floor(Math.random() * 100000), name: 'Guest', photo: '' };
let scene, camera, renderer, clock;
let players = {}; // Object to store all players in the room
let localPlayer;
let maze = [];
let isGameActive = false;
let myRole = 'HIDER'; // Default

// --- DOM Elements ---
const screens = {
    menu: document.getElementById('screen-menu'),
    matchmaking: document.getElementById('screen-matchmaking'),
    gameover: document.getElementById('screen-gameover')
};
const hud = document.getElementById('hud');
const fadeOverlay = document.getElementById('fade-overlay');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initTelegram();
    setupButtons();
    initThreeBackground();
});

function initTelegram() {
    const tg = window.Telegram.WebApp;
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const user = tg.initDataUnsafe.user;
        currentUser.id = user.id.toString();
        currentUser.name = user.first_name + (user.last_name ? ' ' + user.last_name : '');
        currentUser.photo = user.photo_url || '';

        document.getElementById('username-text').innerText = currentUser.name;
        if (currentUser.photo) {
            document.getElementById('avatar-img').src = currentUser.photo;
        }
        tg.expand();
    } else {
        console.log('Running in Browser/Guest Mode');
    }
}

function setupButtons() {
    document.getElementById('btn-find-game').onclick = () => startMatchmaking();
    document.getElementById('btn-create-room').onclick = () => createRoom();
    document.getElementById('btn-cancel-match').onclick = () => stopMatchmaking();
}

function showScreen(screenKey) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenKey].classList.add('active');
}

// --- Background 3D Animation for Menu ---
function initThreeBackground() {
    const container = document.getElementById('bg-canvas');
    const width = window.innerWidth;
    const height = window.innerHeight;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    // Particles/Stars
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    for (let i = 0; i < 5000; i++) {
        vertices.push(
            Math.random() * 2000 - 1000,
            Math.random() * 2000 - 1000,
            Math.random() * 2000 - 1000
        );
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.PointsMaterial({ color: 0x00f2ff, size: 2, transparent: true, opacity: 0.5 });
    const points = new THREE.Points(geometry, material);
    scene.scenePoints = points;
    scene.add(points);

    camera.position.z = 500;

    function animate() {
        requestAnimationFrame(animate);
        points.rotation.y += 0.0005;
        points.rotation.x += 0.0002;
        renderer.render(scene, camera);
    }
    animate();

    window.onresize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    };
}

// --- Matchmaking & Networking ---
function connectSocket() {
    if (socket) return;

    console.log("Sunucuya bağlanılıyor:", CONFIG.SERVER_URL);
    document.getElementById('match-status').innerText = 'Sunucuya bağlanılıyor...';

    socket = io(CONFIG.SERVER_URL, {
        reconnectionAttempts: 5,
        timeout: 10000,
        query: {
            id: currentUser.id,
            name: currentUser.name,
            photo: currentUser.photo
        }
    });

    socket.on('connect', () => {
        console.log('Sunucuya bağlandı!');
        document.getElementById('match-status').innerText = 'Sıraya girildi, rakipler aranıyor...';
    });

    socket.on('connect_error', (error) => {
        console.error('Bağlantı Hatası:', error);
        document.getElementById('match-status').innerText = 'Bağlantı Hatası! Sunucu kapalı olabilir.';
    });

    socket.on('match_found', (data) => {
        console.log('Match Found!', data);
        prepareGame(data);
    });

    socket.on('player_update', (data) => {
        updateRemotePlayers(data);
    });

    socket.on('timer_update', (timeLeft) => {
        updateHUDTimer(timeLeft);
    });

    socket.on('player_tagged', (data) => {
        showTagNotification(data);
    });

    socket.on('game_start', (data) => {
        isGameActive = true;
    });

    socket.on('game_over', (data) => {
        handleGameOver(data);
    });
}

function updateHUDTimer(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    document.getElementById('hud-timer').innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
}

function showTagNotification(data) {
    // Show a quick UI splash when someone is caught
    console.log(`${data.name} was caught!`);
    if (data.id === currentUser.id) {
        document.getElementById('hud-role').innerText = 'CAUGHT!';
        document.getElementById('hud-role').style.color = '#555';
    }
}

function startMatchmaking() {
    showScreen('matchmaking');
    connectSocket();
    socket.emit('join_queue');
}

function stopMatchmaking() {
    if (socket) {
        socket.emit('leave_queue');
        socket.disconnect();
        socket = null;
    }
    showScreen('menu');
}

function createRoom() {
    showScreen('matchmaking');
    connectSocket();
    socket.emit('create_room');
}

// --- Game Engine Implementation ---
function prepareGame(data) {
    fadeOverlay.classList.add('visible');
    setTimeout(() => {
        // Switch from background scene to game scene
        initGameWorld(data);
        showScreen('none'); // Hide all screens
        hud.style.display = 'block';
        fadeOverlay.classList.remove('visible');
    }, 500);
}

function initGameWorld(initData) {
    // Clear menu scene
    while (scene.children.length > 0) {
        scene.remove(scene.children[0]);
    }

    camera.position.set(0, 1.7, 0); // FPS height
    camera.lookAt(0, 1.7, -1);

    // Lights
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(hemiLight);

    // Maze / Environment
    generateMaze(initData.mazeSeed || 123);

    // Players setup
    myRole = initData.role || 'HIDER';
    document.getElementById('hud-role').innerText = myRole;
    document.getElementById('hud-role').style.color = myRole === 'SEEKER' ? 'var(--accent)' : 'var(--primary)';

    // Setup Controls
    setupControls();
}

function generateMaze(seed) {
    const wallGeo = new THREE.BoxGeometry(2, 4, 2);
    const wallMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a2e,
        roughness: 0.7,
        metalness: 0.3
    });

    const floorGeo = new THREE.PlaneGeometry(100, 100);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0f });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Create a simple procedural maze based on seed
    for (let x = -20; x < 20; x += 2) {
        for (let z = -20; z < 20; z += 2) {
            // Pseudo-random walls
            if (Math.abs(x) > 4 || Math.abs(z) > 4) { // Keep center clear
                const r = Math.sin(x * 1.5 + z * 0.5 + seed) * 10;
                if (r > 3) {
                    const wall = new THREE.Mesh(wallGeo, wallMat);
                    wall.position.set(x, 2, z);
                    scene.add(wall);
                }
            }
        }
    }

    // Add Bases (Safe Zones)
    createBase(-15, -15, 0x00ff00); // Team A Base
    createBase(15, 15, 0xff0000);   // Team B Base
}

function createBase(x, z, color) {
    const geo = new THREE.CylinderGeometry(3, 3, 0.1, 32);
    const mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.3 });
    const base = new THREE.Mesh(geo, mat);
    base.position.set(x, 0.05, z);
    scene.add(base);

    // Glow effect
    const light = new THREE.PointLight(color, 1, 10);
    light.position.set(x, 2, z);
    scene.add(light);
}

// --- Player Controls ---
let keys = {};
let pitch = 0, yaw = 0;

function setupControls() {
    window.addEventListener('keydown', e => keys[e.code] = true);
    window.addEventListener('keyup', e => keys[e.code] = false);

    document.addEventListener('mousemove', e => {
        if (document.pointerLockElement) {
            yaw -= e.movementX * CONFIG.LOOK_SENSITIVITY;
            pitch -= e.movementY * CONFIG.LOOK_SENSITIVITY;
            pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch));

            camera.rotation.order = 'YXZ';
            camera.rotation.y = yaw;
            camera.rotation.x = pitch;
        }
    });

    document.body.onclick = () => {
        if (!isGameActive && screens.menu.classList.contains('active')) return;
        document.body.requestPointerLock();
    };

    // Game loop for movement
    function update() {
        requestAnimationFrame(update);
        if (isGameActive && socket) {
            handleMovement();
            socket.emit('player_move', {
                x: camera.position.x,
                y: camera.position.y,
                z: camera.position.z,
                ry: camera.rotation.y
            });
        }
        renderer.render(scene, camera);
    }
    update();
}

function handleMovement() {
    const dir = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);

    forward.y = 0;
    right.y = 0;
    forward.normalize();
    right.normalize();

    if (keys['KeyW']) dir.add(forward);
    if (keys['KeyS']) dir.sub(forward);
    if (keys['KeyA']) dir.sub(right);
    if (keys['KeyD']) dir.add(right);

    if (dir.length() > 0) {
        dir.normalize().multiplyScalar(CONFIG.PLAYER_SPEED);

        // Simple Collision (Check next position)
        const nextPos = camera.position.clone().add(dir);
        if (!checkWallCollision(nextPos)) {
            camera.position.copy(nextPos);
        }
    }
}

function checkWallCollision(pos) {
    // Simple grid-based or raycasting collision if needed.
    // For now, let's just bounds check the arena
    return (Math.abs(pos.x) > 25 || Math.abs(pos.z) > 25);
}

function updateRemotePlayers(data) {
    // data is an object of all players in room
    Object.keys(data).forEach(id => {
        if (id === currentUser.id) return;

        if (!players[id]) {
            // Create player mesh
            const geo = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
            const mat = new THREE.MeshStandardMaterial({ color: data[id].role === 'SEEKER' ? 0xff0000 : 0x00f2ff });
            const mesh = new THREE.Mesh(geo, mat);
            scene.add(mesh);
            players[id] = mesh;
        }

        const p = data[id];
        players[id].position.set(p.x, p.y - 0.5, p.z);
        players[id].rotation.y = p.ry;
    });
}

function startGameCountdown(data) {
    isGameActive = true;
    console.log('Game Started!');
}

function handleGameOver(data) {
    isGameActive = false;
    document.exitPointerLock();
    fadeOverlay.classList.add('visible');

    setTimeout(() => {
        showScreen('gameover');
        document.getElementById('hud').style.display = 'none';
        document.getElementById('winner-text').innerText = data.winner + " WINS!";
        document.getElementById('result-message').innerText = data.message;
        fadeOverlay.classList.remove('visible');
    }, 1000);
}
