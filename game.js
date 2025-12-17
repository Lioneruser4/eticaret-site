/**
 * ULTRA STRIKE 3D - PROFESSIONAL FPS ENGINE (v4.0)
 * PUBG TDM Style - Bright Arena - Rapid Fire - Fixed Physics
 */

const CONFIG = {
    SERVER: window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://saskioyunu.onrender.com',
    MOVE_SPEED: 0.18,
    LOOK_SPEED: 0.002,
    BULLET_SPEED: 1.5,
    FIRE_RATE: 120, // ms between shots
    GRAVITY: 0.05
};

let socket, scene, camera, renderer, myId;
let players = {}, bullets = [], myStats = { ammo: 30, hp: 100, reloading: false };
let currentUser = { id: 'guest_' + Math.floor(Math.random() * 9999), name: 'Agent' };
let keys = {}, isFiring = false, lastFireTime = 0;

document.addEventListener('DOMContentLoaded', () => {
    initTelegram();
    initMenu();
    document.getElementById('btn-start').onclick = startGame;

    // Global Listeners
    window.addEventListener('keydown', e => keys[e.code] = true);
    window.addEventListener('keyup', e => keys[e.code] = false);

    // Rapid Fire Listeners (PC)
    window.addEventListener('mousedown', () => { if (document.pointerLockElement) isFiring = true; });
    window.addEventListener('mouseup', () => { isFiring = false; });

    // Mobile Buttons
    const fireBtn = document.getElementById('fire-btn');
    fireBtn.addEventListener('touchstart', (e) => { e.preventDefault(); isFiring = true; });
    fireBtn.addEventListener('touchend', (e) => { e.preventDefault(); isFiring = false; });
    document.getElementById('reload-btn').addEventListener('touchstart', (e) => { e.preventDefault(); reload(); });
});

function initTelegram() {
    const tg = window.Telegram.WebApp;
    if (tg?.initDataUnsafe?.user) {
        const u = tg.initDataUnsafe.user;
        currentUser = { id: u.id.toString(), name: u.first_name, photo: u.photo_url };
        document.getElementById('user-name').innerText = u.first_name;
        if (u.photo_url) document.getElementById('user-avatar').src = u.photo_url;
        tg.expand();
    }
}

function initMenu() {
    const canvas = document.getElementById('bg-canvas');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a15);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    canvas.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const pl = new THREE.PointLight(0x00f2ff, 5, 100);
    pl.position.set(10, 10, 10);
    scene.add(pl);

    const geo = new THREE.BoxGeometry(20, 20, 20);
    const mat = new THREE.MeshPhongMaterial({ color: 0x00f2ff, wireframe: true });
    const cube = new THREE.Mesh(geo, mat);
    scene.add(cube);
    camera.position.z = 50;

    function orbit() {
        if (!myId) {
            requestAnimationFrame(orbit);
            cube.rotation.x += 0.01;
            cube.rotation.y += 0.01;
            renderer.render(scene, camera);
        }
    }
    orbit();
}

function startGame() {
    document.getElementById('screen-menu').classList.remove('active');
    document.getElementById('screen-loading').classList.add('active');

    socket = io(CONFIG.SERVER, { query: currentUser, transports: ['websocket'] });

    socket.on('init', data => {
        myId = data.id;
        setupWorld();
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
        camera.position.set(data.x, 1.7, data.z);
        myStats.hp = 100; updateHUD();
    });
}

function setupWorld() {
    while (scene.children.length > 0) scene.remove(scene.children[0]);

    // --- BRIGHT ENVIRONMENT (Like PUBG TDM Day) ---
    scene.background = new THREE.Color(0x87CEEB); // Sky Blue
    scene.fog = new THREE.Fog(0x87CEEB, 20, 150);

    // Heavy Brightness
    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(50, 100, 50);
    scene.add(sun);

    // Colorful Floor (Arena Road)
    const floorGeo = new THREE.PlaneGeometry(200, 200);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9, metalness: 0.1 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Adding Grid Lines for depth
    const grid = new THREE.GridHelper(200, 40, 0x00f2ff, 0x444444);
    grid.position.y = 0.05;
    scene.add(grid);

    // Colorful Walls & Boxes (TDM Style)
    const boxGeo = new THREE.BoxGeometry(4, 5, 4);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xffcc00 }); // Yellow Crate
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x00f2ff }); // Blue Neon Wall

    for (let i = 0; i < 30; i++) {
        const box = new THREE.Mesh(boxGeo, i % 2 ? boxMat : wallMat);
        box.position.set(Math.random() * 120 - 60, 2.5, Math.random() * 120 - 60);
        if (box.position.length() > 8) scene.add(box);
    }

    // Bounds - Prevent "Flying" or escaping
    camera.position.set(0, 1.7, 0);

    // Gun View
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.6), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    gun.position.set(0.3, -0.3, -0.5);
    camera.add(gun);
    scene.add(camera);

    loop();
}

let yaw = 0, pitch = 0;
document.addEventListener('mousemove', e => {
    if (document.pointerLockElement) {
        yaw -= e.movementX * CONFIG.LOOK_SPEED;
        pitch -= e.movementY * CONFIG.LOOK_SPEED;
        pitch = Math.max(-1.4, Math.min(1.4, pitch));
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }
});

document.body.onclick = () => {
    if (myId && !document.pointerLockElement && !('ontouchstart' in window)) {
        document.body.requestPointerLock();
    }
};

function loop() {
    requestAnimationFrame(loop);

    handleInput();
    updateBullets();

    // Rapid Fire Logic
    if (isFiring) {
        const now = Date.now();
        if (now - lastFireTime > CONFIG.FIRE_RATE) {
            shoot();
            lastFireTime = now;
        }
    }

    if (socket && socket.connected) {
        socket.emit('move', { x: camera.position.x, y: camera.position.y, z: camera.position.z, ry: yaw });
    }

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

    if (dir.length() > 0) {
        dir.normalize().multiplyScalar(CONFIG.MOVE_SPEED);
        const next = camera.position.clone().add(dir);

        // --- FIXED PHYSICS & COLLISION ---
        // Basic Bounds
        if (Math.abs(next.x) < 95 && Math.abs(next.z) < 95) {
            // Check world collision (simple)
            camera.position.x = next.x;
            camera.position.z = next.z;
        }
    }

    // Force Grounding - NO FLYING
    camera.position.y = 1.7;

    if (keys['KeyR']) reload();
}

function shoot() {
    if (myStats.ammo <= 0 || myStats.reloading) {
        if (myStats.ammo <= 0) reload();
        return;
    }

    myStats.ammo--;
    updateHUD();

    // Raycast Damage
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: 0, y: 0 }, camera);
    const targets = Object.values(players).map(p => p.body).filter(b => b);
    const hits = ray.intersectObjects(targets);
    if (hits.length > 0) {
        socket.emit('hit', { targetId: hits[0].object.userData.id });
    }

    // Local FX
    const p = camera.position.clone();
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    const bData = { pos: p, dir: d, color: '#00f2ff' };
    spawnBullet(bData);
    socket.emit('shoot', bData);
}

function reload() {
    if (myStats.reloading || myStats.ammo === 30) return;
    myStats.reloading = true;
    document.getElementById('ammo-count').innerText = "RELOADING...";
    setTimeout(() => {
        myStats.ammo = 30;
        myStats.reloading = false;
        updateHUD();
    }, 1500);
}

function spawnBullet(data) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: data.color }));
    b.position.copy(data.pos);
    b.userData.dir = new THREE.Vector3(data.dir.x, data.dir.y, data.dir.z);
    b.userData.life = 60;
    scene.add(b);
    bullets.push(b);
}

function updateBullets() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.position.add(b.userData.dir.clone().multiplyScalar(CONFIG.BULLET_SPEED));
        if (--b.userData.life <= 0) {
            scene.remove(b);
            bullets.splice(i, 1);
        }
    }
}

function syncPlayers(data) {
    Object.keys(data).forEach(id => {
        if (id === myId) return;
        if (!players[id]) {
            const group = new THREE.Group();
            const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 4, 8), new THREE.MeshStandardMaterial({ color: data[id].color }));
            body.position.y = 0.9;
            body.userData.id = id;
            group.add(body);
            scene.add(group);
            players[id] = { mesh: group, body: body };
        }
        players[id].mesh.position.set(data[id].x, data[id].y - 1.7, data[id].z);
        players[id].mesh.rotation.y = data[id].ry;
        players[id].mesh.visible = data[id].hp > 0;
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
    div.innerHTML = `<b style="color:#ff0055">${data.killer}</b> <i class="fas fa-bolt"></i> ${data.victim}`;
    f.prepend(div);
    setTimeout(() => div.remove(), 4000);
}
