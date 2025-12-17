// --- Configuration ---
const CONFIG = {
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
let players = {};
let isGameActive = false;
let myRole = 'HIDER';
let keys = {}; // Klavye girişlerini saklar

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

    // Klavye dinleyicilerini en başta kur (W,A,S,D için)
    window.addEventListener('keydown', e => { keys[e.code] = true; });
    window.addEventListener('keyup', e => { keys[e.code] = false; });
});

function initTelegram() {
    const tg = window.Telegram.WebApp;
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const user = tg.initDataUnsafe.user;
        currentUser.id = user.id.toString();
        currentUser.name = user.first_name + (user.last_name ? ' ' + user.last_name : '');
        currentUser.photo = user.photo_url || '';
        document.getElementById('username-text').innerText = currentUser.name;
        if (currentUser.photo) document.getElementById('avatar-img').src = currentUser.photo;
        tg.expand();
    }
}

function setupButtons() {
    document.getElementById('btn-find-game').onclick = () => startMatchmaking();
    document.getElementById('btn-create-room').onclick = () => createRoom();
    document.getElementById('btn-cancel-match').onclick = () => stopMatchmaking();
}

function connectSocket() {
    if (socket) return;
    socket = io(CONFIG.SERVER_URL, {
        query: { id: currentUser.id, name: currentUser.name, photo: currentUser.photo }
    });

    socket.on('connect', () => { document.getElementById('match-status').innerText = 'Searching...'; });
    socket.on('match_found', (data) => prepareGame(data));
    socket.on('player_update', (data) => updateRemotePlayers(data));
    socket.on('timer_update', (timeLeft) => updateHUDTimer(timeLeft));
    socket.on('player_tagged', (data) => showTagNotification(data));
    socket.on('game_start', () => { isGameActive = true; });
    socket.on('game_over', (data) => handleGameOver(data));
}

function startMatchmaking() {
    showScreen('matchmaking');
    connectSocket();
    socket.emit('join_queue');
}

function stopMatchmaking() {
    if (socket) { socket.emit('leave_queue'); socket.disconnect(); socket = null; }
    showScreen('menu');
}

function createRoom() {
    showScreen('matchmaking');
    connectSocket();
    socket.emit('create_room');
}

function showScreen(screenKey) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    if (screens[screenKey]) screens[screenKey].classList.add('active');
}

// --- 3D Engine ---
function initThreeBackground() {
    const container = document.getElementById('bg-canvas');
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const geo = new THREE.BufferGeometry();
    const verts = [];
    for (let i = 0; i < 5000; i++) verts.push(Math.random() * 2000 - 1000, Math.random() * 2000 - 1000, Math.random() * 2000 - 1000);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.PointsMaterial({ color: 0x00f2ff, size: 2, transparent: true, opacity: 0.5 });
    const points = new THREE.Points(geo, mat);
    scene.add(points);
    camera.position.z = 500;

    function animate() {
        if (!isGameActive) {
            requestAnimationFrame(animate);
            points.rotation.y += 0.0005;
            renderer.render(scene, camera);
        }
    }
    animate();
}

function prepareGame(data) {
    fadeOverlay.classList.add('visible');
    setTimeout(() => {
        initGameWorld(data);
        Object.values(screens).forEach(s => s.classList.remove('active'));
        hud.style.display = 'block';
        fadeOverlay.classList.remove('visible');
    }, 1500);
}

function initGameWorld(initData) {
    while (scene.children.length > 0) scene.remove(scene.children[0]);

    camera.position.set(0, 1.7, 0);

    // IŞIKLARI ARTIRDIK (Çok daha aydınlık)
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);
    const hemiLight = new THREE.HemisphereLight(0x00f2ff, 0xff007a, 1.2);
    scene.add(hemiLight);

    // Labirent
    generateMaze(initData.mazeSeed || 123);

    myRole = initData.role || 'HIDER';
    const roleEl = document.getElementById('hud-role');
    roleEl.innerText = myRole;
    roleEl.style.color = myRole === 'SEEKER' ? '#ff007a' : '#00f2ff';

    setupControls();
    isGameActive = true; // Oyunu başlat
}

function generateMaze(seed) {
    const wallGeo = new THREE.BoxGeometry(2.1, 4.5, 2.1);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x222244, roughness: 0.3, metalness: 0.5 });

    const floorGeo = new THREE.PlaneGeometry(100, 100);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x111122 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Maze generation
    for (let x = -25; x < 25; x += 2) {
        for (let z = -25; z < 25; z += 2) {
            if (Math.abs(x) > 4 || Math.abs(z) > 4) {
                const r = Math.sin(x * 1.5 + z * 0.5 + seed) * 10;
                if (r > 3) {
                    const wall = new THREE.Mesh(wallGeo, wallMat);
                    wall.position.set(x, 2.25, z);
                    scene.add(wall);
                }
            }
        }
    }
    createBase(-15, -15, 0x00ff00);
    createBase(15, 15, 0xff0000);
}

function createBase(x, z, color) {
    const geo = new THREE.CylinderGeometry(4, 4, 0.2, 32);
    const mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.4 });
    const base = new THREE.Mesh(geo, mat);
    base.position.set(x, 0.1, z);
    scene.add(base);
    const light = new THREE.PointLight(color, 5, 15);
    light.position.set(x, 2, z);
    scene.add(light);
}

let pitch = 0, yaw = 0;
function setupControls() {
    document.addEventListener('mousemove', e => {
        if (document.pointerLockElement) {
            yaw -= e.movementX * CONFIG.LOOK_SENSITIVITY;
            pitch -= e.movementY * CONFIG.LOOK_SENSITIVITY;
            pitch = Math.max(-1.5, Math.min(1.5, pitch));
            camera.rotation.set(pitch, yaw, 0, 'YXZ');
        }
    });

    document.body.onclick = () => { if (isGameActive) document.body.requestPointerLock(); };

    function updateLoop() {
        requestAnimationFrame(updateLoop);
        if (isGameActive) {
            handleMovement();
            if (socket) socket.emit('player_move', {
                x: camera.position.x, y: camera.position.y, z: camera.position.z, ry: camera.rotation.y
            });
        }
        renderer.render(scene, camera);
    }
    updateLoop();
}

function handleMovement() {
    const dir = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    forward.y = 0; right.y = 0;
    forward.normalize(); right.normalize();

    if (keys['KeyW']) dir.add(forward);
    if (keys['KeyS']) dir.sub(forward);
    if (keys['KeyA']) dir.sub(right);
    if (keys['KeyD']) dir.add(right);

    if (dir.length() > 0) {
        dir.normalize().multiplyScalar(CONFIG.PLAYER_SPEED);
        const nextPos = camera.position.clone().add(dir);
        if (Math.abs(nextPos.x) < 25 && Math.abs(nextPos.z) < 25) {
            camera.position.copy(nextPos);
        }
    }
}

function updateRemotePlayers(data) {
    Object.keys(data).forEach(id => {
        if (id === currentUser.id) return;
        if (!players[id]) {
            const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 4, 8), new THREE.MeshStandardMaterial({
                color: data[id].role === 'SEEKER' ? 0xff007a : 0x00f2ff,
                emissive: data[id].role === 'SEEKER' ? 0x220000 : 0x002222
            }));
            scene.add(mesh);
            players[id] = mesh;
        }
        const p = data[id];
        players[id].position.set(p.x, p.y - 0.5, p.z);
        players[id].rotation.y = p.ry;
    });
}

function updateHUDTimer(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    document.getElementById('hud-timer').innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
}

function showTagNotification(data) {
    if (data.id === currentUser.id) {
        document.getElementById('hud-role').innerText = 'CAUGHT!';
        document.getElementById('hud-role').style.color = '#ff0000';
    }
}

function handleGameOver(data) {
    isGameActive = false;
    document.exitPointerLock();
    fadeOverlay.classList.add('visible');
    setTimeout(() => {
        showScreen('gameover');
        hud.style.display = 'none';
        document.getElementById('winner-text').innerText = data.winner + " WINS!";
        document.getElementById('result-message').innerText = data.message;
        fadeOverlay.classList.remove('visible');
    }, 1000);
}
