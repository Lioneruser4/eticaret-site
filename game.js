/**
 * HIDE & SEEK 3D - PROFESSIONAL GAME ENGINE
 */

const CONFIG = {
    SERVER: window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://saskioyunu.onrender.com',
    SPEED: 0.16,
    SENSE: 0.002
};

let socket, scene, camera, renderer, currentUser = { id: 'guest_' + Math.floor(Math.random() * 9999) };
let players = {}, isGameActive = false, myRole = 'HIDER', keys = {};
const fade = document.getElementById('fade-overlay');

document.addEventListener('DOMContentLoaded', () => {
    initLobby();
    initThreeMenu();
    setupSocket();

    window.addEventListener('keydown', e => keys[e.code] = true);
    window.addEventListener('keyup', e => keys[e.code] = false);
});

function initLobby() {
    const tg = window.Telegram.WebApp;
    if (tg?.initDataUnsafe?.user) {
        const u = tg.initDataUnsafe.user;
        currentUser = { id: u.id.toString(), name: u.first_name, photo: u.photo_url };
        document.getElementById('username-text').innerText = u.first_name;
        if (u.photo_url) document.getElementById('avatar-img').src = u.photo_url;
    }

    document.getElementById('btn-matchmaking').onclick = () => {
        showScreen('screen-matchmaking');
        socket.emit('join_matchmaking');
    };

    document.getElementById('btn-confirm-create').onclick = () => {
        const name = document.getElementById('input-room-name').value;
        const pass = document.getElementById('input-room-pass').value;
        socket.emit('create_room', { name, pass });
        closeModals();
        showScreen('screen-matchmaking');
    };
}

function setupSocket() {
    socket = io(CONFIG.SERVER, { query: currentUser });

    socket.on('room_list', list => updateRoomUI(list));
    socket.on('room_start', data => prepareLevel(data));
    socket.on('room_update', players => syncPlayers(players));
    socket.on('tick', time => updateHUD(time));
    socket.on('tagged', data => { if (data.id === currentUser.id) handleCaught(); });
    socket.on('game_over', data => showGameOver(data));
    socket.on('error_msg', msg => { alert(msg); showScreen('screen-menu'); });
}

function requestRooms() { socket.emit('get_rooms'); }

function updateRoomUI(list) {
    const cont = document.getElementById('room-list');
    cont.innerHTML = list.length ? '' : '<p style="text-align: center; color: #666;">No rooms active.</p>';
    list.forEach(r => {
        const div = document.createElement('div');
        div.className = 'room-item';
        div.innerHTML = `
            <div class="room-info"><h4>${r.name}</h4><span>Players: ${r.players}/8 ${r.hasPass ? '🔒' : ''}</span></div>
            <button class="join-mini-btn" onclick="handleJoinClick('${r.id}', ${r.hasPass})">JOIN</button>
        `;
        cont.appendChild(div);
    });
}

function handleJoinClick(id, hasPass) {
    if (!hasPass) return socket.emit('join_room', { id, pass: '' });
    document.getElementById('modal-pass').style.display = 'flex';
    document.getElementById('btn-confirm-join').onclick = () => {
        const pass = document.getElementById('input-join-pass').value;
        socket.emit('join_room', { id, pass });
        closeModals();
        showScreen('screen-matchmaking');
    };
}

// --- CHARACTER FACTORY (Humanoid + Animation) ---
function createHumanoid(color) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.5, 4, 8), mat);
    body.position.y = 0.7;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), mat);
    head.position.y = 1.25;
    group.add(head);

    // Legs
    const lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), mat);
    lLeg.position.set(-0.12, 0.25, 0);
    group.add(lLeg);
    const rLeg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), mat);
    rLeg.position.set(0.12, 0.25, 0);
    group.add(rLeg);

    group.legs = [lLeg, rLeg];
    return group;
}

function animateHumanoid(mesh, time, isWalking) {
    if (!isWalking) {
        mesh.legs[0].rotation.x = 0;
        mesh.legs[1].rotation.x = 0;
        return;
    }
    const wave = Math.sin(time * 10) * 0.5;
    mesh.legs[0].rotation.x = wave;
    mesh.legs[1].rotation.x = -wave;
}

// --- Engine ---
function initThreeMenu() {
    const c = document.getElementById('bg-canvas');
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    c.appendChild(renderer.domElement);

    const geo = new THREE.BufferGeometry();
    const v = [];
    for (let i = 0; i < 3000; i++) v.push(Math.random() * 1600 - 800, Math.random() * 1600 - 800, Math.random() * 1600 - 800);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x00f2ff, size: 2 }));
    scene.add(stars);
    camera.position.z = 400;

    function loop() {
        if (!isGameActive) {
            requestAnimationFrame(loop);
            stars.rotation.y += 0.0003;
            renderer.render(scene, camera);
        }
    }
    loop();
}

function prepareLevel(data) {
    const prompt = document.getElementById('click-prompt');
    prompt.style.display = 'block';
    prompt.onclick = () => {
        prompt.style.display = 'none';
        document.body.requestPointerLock();
        startWorld(data);
    };
}

function startWorld(data) {
    while (scene.children.length > 0) scene.remove(scene.children[0]);

    // Better Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(5, 10, 7);
    scene.add(sun);

    generateMaze(data.seed);
    myRole = data.role;
    isGameActive = true;

    document.getElementById('hud').style.display = 'block';
    document.getElementById('hud-role').innerText = myRole;
    document.getElementById('hud-role').style.color = myRole === 'SEEKER' ? '#ff007a' : '#00f2ff';
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

    engineLoop();
}

function generateMaze(seed) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x111118 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const wallGeo = new THREE.BoxGeometry(2, 4, 2);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x222233 });
    for (let x = -20; x < 20; x += 2) {
        for (let z = -20; z < 20; z += 2) {
            if (Math.abs(x) > 4 || Math.abs(z) > 4) {
                if (Math.sin(x * 1.2 + z * 0.8 + seed) * 10 > 4) {
                    const w = new THREE.Mesh(wallGeo, wallMat);
                    w.position.set(x, 2, z);
                    scene.add(w);
                }
            }
        }
    }
    // Bases
    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.1), new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.3 }));
    b1.position.set(-15, 0.05, -15); scene.add(b1);
    const b2 = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.1), new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.3 }));
    b2.position.set(15, 0.05, 15); scene.add(b2);
}

let yaw = 0, pitch = 0;
document.addEventListener('mousemove', e => {
    if (document.pointerLockElement) {
        yaw -= e.movementX * CONFIG.SENSE;
        pitch -= e.movementY * CONFIG.SENSE;
        pitch = Math.max(-1.4, Math.min(1.4, pitch));
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }
});

function engineLoop() {
    if (!isGameActive) return;
    requestAnimationFrame(engineLoop);

    const isWalking = handleInput();

    socket.emit('player_move', {
        x: camera.position.x, y: camera.position.y, z: camera.position.z, ry: yaw, isWalking
    });

    const time = Date.now() * 0.001;
    Object.values(players).forEach(p => animateHumanoid(p, time, p.userData.isWalking));

    renderer.render(scene, camera);
}

function handleInput() {
    const dir = new THREE.Vector3();
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    f.y = 0; r.y = 0; f.normalize(); r.normalize();

    if (keys['KeyW']) dir.add(f);
    if (keys['KeyS']) dir.sub(f);
    if (keys['KeyA']) dir.sub(r);
    if (keys['KeyD']) dir.add(r);

    const active = dir.length() > 0;
    if (active) {
        dir.normalize().multiplyScalar(CONFIG.SPEED);
        const next = camera.position.clone().add(dir);
        if (Math.abs(next.x) < 38 && Math.abs(next.z) < 38) camera.position.copy(next);
    }
    return active;
}

function syncPlayers(data) {
    Object.keys(data).forEach(id => {
        if (id === currentUser.id) return;
        if (!players[id]) {
            players[id] = createHumanoid(data[id].r === 'SEEKER' ? 0xff007a : 0x00f2ff);
            scene.add(players[id]);
        }
        const p = data[id];
        players[id].position.set(p.x, p.y - 1.7, p.z);
        players[id].rotation.y = p.ry;
        players[id].userData.isWalking = p.w;
        if (p.t) players[id].visible = false; // Hide caught players
    });
}

function updateHUD(time) {
    const m = Math.floor(time / 60), s = time % 60;
    document.getElementById('hud-timer').innerText = `${m}:${s.toString().padStart(2, '0')}`;
}

function handleCaught() {
    myRole = 'SPECTATOR';
    document.getElementById('hud-role').innerText = 'CAUGHT!';
    document.getElementById('hud-role').style.color = '#888';
}

function showGameOver(data) {
    isGameActive = false;
    document.exitPointerLock();
    document.getElementById('hud').style.display = 'none';
    const screen = document.getElementById('screen-gameover');
    screen.classList.add('active');
    document.getElementById('winner-text').innerText = data.winner + " WIN";
    document.getElementById('result-message').innerText = data.msg;
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}
function closeModals() { document.querySelectorAll('.modal').forEach(m => m.style.display = 'none'); }
