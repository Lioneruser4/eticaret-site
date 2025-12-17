/**
 * HIDE & SEEK 3D - ELITE ENGINE (v3.0)
 * Multi-round, Multi-player (up to 10), Team Based
 */

const CONFIG = {
    SERVER: window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://saskioyunu.onrender.com',
    SPEED: 0.18,
    SENSE: 0.002
};

let socket, scene, camera, renderer, currentUser = { id: 'guest_' + Math.floor(Math.random() * 9999) };
let players = {}, isGameActive = false, myRole = 'HIDER', keys = {};
const fade = document.getElementById('fade-overlay');

document.addEventListener('DOMContentLoaded', () => {
    initLobby();
    initThreeBackground();
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
        const max = document.getElementById('input-room-max').value;
        socket.emit('create_room', { name, pass, maxPlayers: parseInt(max) });
        closeModals();
        showScreen('screen-matchmaking');
    };
}

function setupSocket() {
    socket = io(CONFIG.SERVER, { query: currentUser });

    socket.on('room_list', list => updateRoomUI(list));
    socket.on('room_start', data => prepareLevel(data));
    socket.on('room_update', players => syncPlayers(players));
    socket.on('tick', data => updateHUD(data));
    socket.on('round_over', data => showRoundMessage(data));
    socket.on('tagged', data => { if (data.id === currentUser.id) handleCaught(); });
    socket.on('game_over', data => showGameOver(data));
    socket.on('player_joined_room', data => {
        document.getElementById('match-status').innerText = `Waiting for players (${data.count}/${data.max})`;
    });
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
            <div class="room-info"><h4>${r.name}</h4><span>Players: ${r.players}/${r.max} ${r.hasPass ? '🔒' : ''}</span></div>
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

// --- Player Character Model ---
function createHumanoid(color) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: color, metalness: 0.5, roughness: 0.5 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.5, 4, 8), mat);
    body.position.y = 0.7;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), mat);
    head.position.y = 1.25;
    group.add(head);

    const lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), mat);
    lLeg.position.set(-0.12, 0.25, 0);
    group.add(lLeg);
    const rLeg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), mat);
    rLeg.position.set(0.12, 0.25, 0);
    group.add(rLeg);

    group.legs = [lLeg, rLeg];
    group.userData = { isWalking: false };
    return group;
}

function animateHumanoid(mesh, time, isWalking) {
    if (!isWalking) {
        mesh.legs[0].rotation.x = 0;
        mesh.legs[1].rotation.x = 0;
        return;
    }
    const wave = Math.sin(time * 12) * 0.6;
    mesh.legs[0].rotation.x = wave;
    mesh.legs[1].rotation.x = -wave;
}

// --- Background Engine ---
function initThreeBackground() {
    const c = document.getElementById('bg-canvas');
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    c.appendChild(renderer.domElement);

    // Stars background
    const geo = new THREE.BufferGeometry();
    const v = [];
    for (let i = 0; i < 4000; i++) v.push(Math.random() * 2000 - 1000, Math.random() * 2000 - 1000, Math.random() * 2000 - 1000);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    const starMat = new THREE.PointsMaterial({ color: 0x00f2ff, size: 1.5 });
    const stars = new THREE.Points(geo, starMat);
    scene.add(stars);
    camera.position.z = 500;

    function loop() {
        if (!isGameActive) {
            requestAnimationFrame(loop);
            stars.rotation.y += 0.0002;
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
    // Clear everything
    while (scene.children.length > 0) scene.remove(scene.children[0]);

    // Bright professional lighting
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(10, 20, 10);
    scene.add(sun);

    generateColorfulMaze(data.seed);

    myRole = data.role;
    isGameActive = true;

    // HUD Reset
    document.getElementById('hud').style.display = 'block';
    document.getElementById('hud-role').innerText = myRole;
    document.getElementById('hud-role').style.color = myRole === 'SEEKER' ? '#ff007a' : '#00f2ff';
    document.getElementById('hud-round').innerText = `ROUND ${data.round || 1}`;

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

    engineLoop();
}

function generateColorfulMaze(seed) {
    // Light floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Bright Labyrinth Walls
    const wallGeo = new THREE.BoxGeometry(2, 4.5, 2);
    // Use high-quality white material with color accents
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.2 });

    // Clean, dense maze
    for (let x = -30; x <= 30; x += 2.5) {
        for (let z = -30; z <= 30; z += 2.5) {
            // Safe zone skip (center and corners)
            if (Math.abs(x) < 5 && Math.abs(z) < 5) continue;

            const r = Math.sin(x * 0.9 + z * 1.1 + seed) * 10;
            if (r > 4.5) {
                const w = new THREE.Mesh(wallGeo, wallMat.clone());
                w.position.set(x, 2.25, z);
                // Add a random neon strip to walls
                if (Math.random() > 0.7) w.material.emissive.setHex(0x00f2ff);
                scene.add(w);
            }
        }
    }

    // Base Zones (Bright and Glowing)
    createGlowingBase(-20, -20, 0x00ff88); // Team Hiders
    createGlowingBase(20, 20, 0xff0055);   // Team Seekers
}

function createGlowingBase(x, z, color) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.2, 32), new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.3 }));
    base.position.set(x, 0.1, z);
    scene.add(base);

    const light = new THREE.PointLight(color, 8, 20);
    light.position.set(x, 3, z);
    scene.add(light);

    // Add a glowing pillar for visibility
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 50), new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.1 }));
    pillar.position.set(x, 25, z);
    scene.add(pillar);
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

    // Heartbeat to server
    if (socket && socket.connected) {
        socket.emit('player_move', {
            x: camera.position.x, y: camera.position.y, z: camera.position.z, ry: yaw, isWalking
        });
    }

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
        // Map bounds
        if (Math.abs(next.x) < 45 && Math.abs(next.z) < 45) {
            camera.position.copy(next);
        }
    }
    return active;
}

function syncPlayers(data) {
    Object.keys(data).forEach(id => {
        if (id === currentUser.id) return;
        if (!players[id]) {
            players[id] = createHumanoid(data[id].r === 'SEEKER' ? 0xff0055 : 0x00ff88);
            scene.add(players[id]);
        }
        const p = data[id];
        players[id].position.set(p.x, p.y - 1.7, p.z);
        players[id].rotation.y = p.ry;
        players[id].userData.isWalking = p.w;
        players[id].visible = !p.t; // Hide if tagged
    });

    // Clear disconnected
    Object.keys(players).forEach(id => {
        if (!data[id] && id !== currentUser.id) {
            scene.remove(players[id]);
            delete players[id];
        }
    });
}

function updateHUD(data) {
    // data: { time, round, scores: { SEEKERS, HIDERS } }
    const m = Math.floor(data.time / 60), s = data.time % 60;
    document.getElementById('hud-timer').innerText = `${m}:${s.toString().padStart(2, '0')}`;
    document.getElementById('hud-round').innerText = `ROUND ${data.round}`;
    document.getElementById('hud-score').innerText = `S:${data.scores.SEEKERS} H:${data.scores.HIDERS}`;
}

function showRoundMessage(data) {
    // show a temporary text or something?
    alert(`${data.winner} WON THIS ROUND! Next round starting...`);
}

function handleCaught() {
    myRole = 'SPECTATOR';
    document.getElementById('hud-role').innerText = 'TAGGED!';
    document.getElementById('hud-role').style.color = '#ff0055';
}

function showGameOver(data) {
    isGameActive = false;
    document.exitPointerLock();
    document.getElementById('hud').style.display = 'none';
    const screen = document.getElementById('screen-gameover');
    screen.classList.add('active');
    document.getElementById('winner-text').innerText = data.winner + " WINS MATCH";
    document.getElementById('result-message').innerText = data.msg;
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}
function closeModals() { document.querySelectorAll('.modal').forEach(m => m.style.display = 'none'); }
function stopMatchmaking() { location.reload(); }
