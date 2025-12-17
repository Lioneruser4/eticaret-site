/**
 * ULTRA STRIKE 3D - CLIENT ENGINE (v4.2)
 * Humanoid Models - Realistic Speed - Fixed Collision
 */

const CONFIG = {
    SERVER: window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://saskioyunu.onrender.com',
    MOVE_SPEED: 0.12, // Slowed down for realism
    LOOK_SPEED: 0.0022,
    BULLET_SPEED: 1.6,
    FIRE_RATE: 130, // ms
    GRAVITY: 0.05
};

let socket, scene, camera, renderer, myId;
let players = {}, bullets = [], myStats = { ammo: 30, hp: 100, reloading: false };
let currentUser = { id: 'guest_' + Math.floor(Math.random() * 9999), name: 'Agent' };
let keys = {}, isFiring = false, lastFireTime = 0;

document.addEventListener('DOMContentLoaded', () => {
    initTelegram();
    initThreeMenu();
    document.getElementById('btn-start').onclick = startGame;

    window.addEventListener('keydown', e => keys[e.code] = true);
    window.addEventListener('keyup', e => keys[e.code] = false);

    // Rapid Fire
    window.addEventListener('mousedown', (e) => {
        if (document.pointerLockElement) isFiring = true;
    });
    window.addEventListener('mouseup', () => { isFiring = false; });
});

function initTelegram() {
    const tg = window.Telegram.WebApp;
    tg.expand();
    // Extra Telegram Fullscreen request
    if (tg.requestFullscreen) tg.requestFullscreen();

    if (tg?.initDataUnsafe?.user) {
        const u = tg.initDataUnsafe.user;
        currentUser = { id: u.id.toString(), name: u.first_name, photo: u.photo_url };
        document.getElementById('user-name').innerText = u.first_name;
        if (u.photo_url) document.getElementById('user-avatar').src = u.photo_url;
    }
}

function initThreeMenu() {
    const canvas = document.getElementById('bg-canvas');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050510);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    canvas.appendChild(renderer.domElement);

    const stars = new THREE.Group();
    for (let i = 0; i < 1000; i++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.5, 4, 4), new THREE.MeshBasicMaterial({ color: 0x00f2ff }));
        p.position.set(Math.random() * 800 - 400, Math.random() * 800 - 400, Math.random() * 800 - 400);
        stars.add(p);
    }
    scene.add(stars);
    camera.position.z = 50;

    function animate() {
        if (!myId) {
            requestAnimationFrame(animate);
            stars.rotation.y += 0.001;
            renderer.render(scene, camera);
        }
    }
    animate();
}

function startGame() {
    document.getElementById('screen-menu').classList.remove('active');
    document.getElementById('screen-loading').classList.add('active');

    socket = io(CONFIG.SERVER, {
        query: currentUser,
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 10
    });

    socket.on('init', data => {
        myId = data.id;
        setupWarzone();
        syncPlayers(data.players);
        document.getElementById('screen-loading').classList.remove('active');
        document.getElementById('hud').style.display = 'block';
        document.getElementById('crosshair').style.display = 'block';
        if ('ontouchstart' in window) document.getElementById('mobile-controls').style.display = 'block';
    });

    socket.on('update', data => syncPlayers(data));
    socket.on('bullet_fired', data => spawnBullet(data));
    socket.on('player_stats', data => {
        if (data[myId]) { myStats.hp = data[myId].hp; updateHUD(); }
    });
    socket.on('kill_log', data => addKillFeed(data));
    socket.on('respawn', data => {
        camera.position.set(data.x, 1.7, data.z); // Forced Y for ground
        myStats.hp = 100;
        updateHUD();
    });
}

// --- CHARACTER MODEL FACTORY ---
function createHumanModel(color) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color });

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.25), mat);
    torso.position.y = 1.05;
    group.add(torso);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), mat);
    head.position.y = 1.6;
    group.add(head);

    // Arms
    const lArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.4, 4, 8), mat);
    lArm.position.set(-0.35, 1.1, 0);
    group.add(lArm);
    const rArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.4, 4, 8), mat);
    rArm.position.set(0.35, 1.1, 0);
    group.add(rArm);

    // Legs
    const lLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), mat);
    lLeg.position.set(-0.15, 0.4, 0);
    group.add(lLeg);
    const rLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), mat);
    rLeg.position.set(0.15, 0.4, 0);
    group.add(rLeg);

    group.parts = { lLeg, rLeg, lArm, rArm };
    group.userData = { w: false };
    return group;
}

function animateHuman(mesh, time, isWalking) {
    if (!isWalking) {
        mesh.parts.lLeg.rotation.x = 0;
        mesh.parts.rLeg.rotation.x = 0;
        mesh.parts.lArm.rotation.x = 0;
        mesh.parts.rArm.rotation.x = 0;
        return;
    }
    const wave = Math.sin(time * 12) * 0.6;
    mesh.parts.lLeg.rotation.x = wave;
    mesh.parts.rLeg.rotation.x = -wave;
    mesh.parts.lArm.rotation.x = -wave * 0.5;
    mesh.parts.rArm.rotation.x = wave * 0.5;
}

function setupWarzone() {
    while (scene.children.length > 0) scene.remove(scene.children[0]);

    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 20, 150);

    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(100, 200, 100);
    scene.add(sun);

    // TDM Ground
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(250, 250),
        new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const grid = new THREE.GridHelper(250, 50, 0x00f2ff, 0x555555);
    scene.add(grid);

    // Boxes & Barriers
    const boxGeo = new THREE.BoxGeometry(4, 5, 4);
    for (let i = 0; i < 40; i++) {
        const mat = new THREE.MeshStandardMaterial({ color: i % 2 ? 0xffbb00 : 0x00aaff });
        const box = new THREE.Mesh(boxGeo, mat);
        box.position.set(Math.random() * 150 - 75, 2.5, Math.random() * 150 - 75);
        if (box.position.length() > 10) scene.add(box);
    }

    // Gun Model
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.7), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    gun.position.set(0.35, -0.4, -0.6);
    camera.add(gun);
    scene.add(camera);

    renderLoop();
}

function renderLoop() {
    requestAnimationFrame(renderLoop);

    const isWalking = handleInput();
    updateBullets();

    if (isFiring) {
        const now = Date.now();
        if (now - lastFireTime > CONFIG.FIRE_RATE) { shoot(); lastFireTime = now; }
    }

    if (socket?.connected) {
        socket.emit('move', { x: camera.position.x, y: camera.position.y, z: camera.position.z, ry: yaw, w: isWalking });
    }

    const time = Date.now() * 0.001;
    Object.values(players).forEach(p => animateHuman(p.mesh, time, p.userData.w));

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

    const walking = dir.length() > 0;
    if (walking) {
        dir.normalize().multiplyScalar(CONFIG.MOVE_SPEED);
        const next = camera.position.clone().add(dir);
        if (Math.abs(next.x) < 120 && Math.abs(next.z) < 120) {
            camera.position.x = next.x;
            camera.position.z = next.z;
        }
    }
    camera.position.y = 1.7; // LOCKED TO GROUND
    return walking;
}

function shoot() {
    if (myStats.ammo <= 0 || myStats.reloading) { if (myStats.ammo <= 0) reload(); return; }
    myStats.ammo--;
    updateHUD();

    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: 0, y: 0 }, camera);
    const targets = Object.values(players).map(p => p.mesh).filter(m => m);
    const hits = ray.intersectObjects(targets, true);
    if (hits.length > 0) {
        let root = hits[0].object;
        while (root.parent && !root.userData.id) root = root.parent;
        if (root.userData.id) socket.emit('hit', { targetId: root.userData.id });
    }

    const bData = { pos: camera.position.clone(), dir: new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), color: '#00f2ff' };
    spawnBullet(bData);
    socket.emit('shoot', bData);
}

function reload() {
    if (myStats.reloading || myStats.ammo === 30) return;
    myStats.reloading = true;
    document.getElementById('ammo-count').innerText = "RELOADING...";
    setTimeout(() => { myStats.ammo = 30; myStats.reloading = false; updateHUD(); }, 1500);
}

function spawnBullet(data) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshBasicMaterial({ color: data.color }));
    b.position.copy(data.pos);
    b.userData.dir = new THREE.Vector3(data.dir.x, data.dir.y, data.dir.z);
    b.userData.life = 70;
    scene.add(b);
    bullets.push(b);
}

function updateBullets() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        bullets[i].position.add(bullets[i].userData.dir.clone().multiplyScalar(CONFIG.BULLET_SPEED));
        if (--bullets[i].userData.life <= 0) { scene.remove(bullets[i]); bullets.splice(i, 1); }
    }
}

function syncPlayers(data) {
    Object.keys(data).forEach(id => {
        if (id === myId) return;
        if (!players[id]) {
            const m = createHumanModel(data[id].color);
            m.userData.id = id;
            scene.add(m);
            players[id] = { mesh: m, userData: {} };
        }
        const p = data[id];
        players[id].mesh.position.set(p.x, p.y - 1.7, p.z);
        players[id].mesh.rotation.y = p.ry;
        players[id].userData.w = p.w; // Walking sync
        players[id].mesh.visible = p.hp > 0;
    });
    Object.keys(players).forEach(id => {
        if (!data[id]) { scene.remove(players[id].mesh); delete players[id]; }
    });
}

function updateHUD() {
    document.getElementById('ammo-count').innerText = myStats.ammo;
    document.getElementById('hp-fill').style.width = myStats.hp + "%";
}

function addKillFeed(data) {
    const f = document.getElementById('kill-feed');
    const div = document.createElement('div');
    div.innerHTML = `<b style="color:#ff0055">${data.killer}</b> <i class="fas fa-skull"></i> ${data.victim}`;
    f.prepend(div);
    setTimeout(() => div.remove(), 4000);
}

// Mobile
const fireBtn = document.getElementById('fire-btn');
fireBtn.addEventListener('touchstart', (e) => { e.preventDefault(); isFiring = true; });
fireBtn.addEventListener('touchend', (e) => { e.preventDefault(); isFiring = false; });
document.getElementById('reload-btn').addEventListener('touchstart', (e) => { e.preventDefault(); reload(); });

let yaw = 0, pitch = 0;
document.addEventListener('mousemove', e => {
    if (document.pointerLockElement) {
        yaw -= e.movementX * CONFIG.LOOK_SPEED;
        pitch -= e.movementY * CONFIG.LOOK_SPEED;
        pitch = Math.max(-1.4, Math.min(1.4, pitch));
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }
});
