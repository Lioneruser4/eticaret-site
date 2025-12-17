/**
 * ULTRA STRIKE 3D - CLIENT ENGINE
 * Professional FPS Mechanics
 */

const CONFIG = {
    SERVER: window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://saskioyunu.onrender.com',
    MOVE_SPEED: 0.15,
    LOOK_SPEED: 0.002,
    BULLET_SPEED: 1.2
};

let socket, scene, camera, renderer, myId;
let players = {}, bullets = [], myStats = { ammo: 30, hp: 100, reloading: false };
let currentUser = { id: 'guest_' + Math.floor(Math.random() * 9999), name: 'Agent' };
let keys = {};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initTelegram();
    initMenu();
    document.getElementById('btn-start').onclick = startGame;

    window.addEventListener('keydown', e => keys[e.code] = true);
    window.addEventListener('keyup', e => keys[e.code] = false);
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
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    canvas.appendChild(renderer.domElement);

    // Menu Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const pl = new THREE.PointLight(0x00f2ff, 2, 100);
    pl.position.set(10, 10, 10);
    scene.add(pl);

    // Stars
    const geo = new THREE.BufferGeometry();
    const v = [];
    for (let i = 0; i < 3000; i++) v.push(Math.random() * 1000 - 500, Math.random() * 1000 - 500, Math.random() * 1000 - 500);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x00f2ff, size: 2 }));
    scene.add(stars);

    function rotate() {
        if (!myId) {
            requestAnimationFrame(rotate);
            stars.rotation.y += 0.0005;
            renderer.render(scene, camera);
        }
    }
    rotate();
}

function startGame() {
    document.getElementById('screen-menu').classList.remove('active');
    document.getElementById('screen-loading').classList.add('active');

    socket = io(CONFIG.SERVER, { query: currentUser });

    socket.on('init', data => {
        myId = data.id;
        setupBattlefield();
        syncPlayers(data.players);
        document.getElementById('screen-loading').classList.remove('active');
        document.getElementById('hud').style.display = 'block';
        document.getElementById('crosshair').style.display = 'block';
        if ('ontouchstart' in window) document.getElementById('mobile-controls').style.display = 'block';
    });

    socket.on('update', data => syncPlayers(data));
    socket.on('bullet_fired', data => spawnBullet(data));
    socket.on('player_stats', data => {
        if (data[myId]) {
            myStats.hp = data[myId].hp;
            updateHUDStats();
        }
    });
    socket.on('kill_log', data => addKillFeed(data));
    socket.on('respawn', data => {
        camera.position.set(data.x, 1.7, data.z);
        myStats.hp = 100;
        updateHUDStats();
    });
}

function setupBattlefield() {
    while (scene.children.length > 0) scene.remove(scene.children[0]);

    scene.background = new THREE.Color(0x050510);
    scene.fog = new THREE.FogExp2(0x050510, 0.02);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(10, 20, 10);
    scene.add(sun);

    // Floor
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100),
        new THREE.MeshStandardMaterial({ color: 0x111122, roughness: 0.8 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Blocks & Obstacles
    const boxGeo = new THREE.BoxGeometry(3, 4, 3);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x222233 });
    for (let i = 0; i < 40; i++) {
        const box = new THREE.Mesh(boxGeo, boxMat);
        box.position.set(Math.random() * 80 - 40, 2, Math.random() * 80 - 40);
        if (box.position.length() > 5) scene.add(box);
    }

    // Gun Model (Simple)
    const gun = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    gun.add(body);
    gun.position.set(0.3, -0.3, -0.5);
    camera.add(gun);
    scene.add(camera);

    gameLoop();
}

let yaw = 0, pitch = 0;
document.addEventListener('mousemove', e => {
    if (document.pointerLockElement) {
        yaw -= e.movementX * CONFIG.LOOK_SPEED;
        pitch -= e.movementY * CONFIG.LOOK_SPEED;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }
});

document.body.onclick = () => {
    if (myId && !document.pointerLockElement) document.body.requestPointerLock();
    if (myId && document.pointerLockElement) shoot();
};

function gameLoop() {
    requestAnimationFrame(gameLoop);

    handleMovement();
    updateBullets();

    if (socket) {
        socket.emit('move', { x: camera.position.x, y: camera.position.y, z: camera.position.z, ry: yaw });
    }

    renderer.render(scene, camera);
}

function handleMovement() {
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
        if (Math.abs(next.x) < 48 && Math.abs(next.z) < 48) camera.position.copy(next);
    }

    if (keys['KeyR']) reload();
}

function shoot() {
    if (myStats.ammo <= 0 || myStats.reloading) {
        if (myStats.ammo <= 0) reload();
        return;
    }

    myStats.ammo--;
    updateHUDStats();

    // Raycast for Hit Detection
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: 0, y: 0 }, camera);

    const targetMeshes = Object.values(players).map(p => p.mesh).filter(m => m);
    const intersects = ray.intersectObjects(targetMeshes);

    if (intersects.length > 0) {
        const hit = intersects[0].object;
        socket.emit('hit', { targetId: hit.userData.id });
    }

    // Local Bullet Visual
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    const pos = camera.position.clone().add(dir.clone().multiplyScalar(0.5));

    const bulletData = { pos, dir, color: '#00f2ff' };
    spawnBullet(bulletData);
    socket.emit('shoot', bulletData);
}

function reload() {
    if (myStats.reloading || myStats.ammo === 30) return;
    myStats.reloading = true;
    document.getElementById('ammo-count').innerText = "RELOADING";
    setTimeout(() => {
        myStats.ammo = 30;
        myStats.reloading = false;
        updateHUDStats();
    }, 1500);
}

function spawnBullet(data) {
    const geo = new THREE.SphereGeometry(0.05, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: data.color });
    const b = new THREE.Mesh(geo, mat);
    b.position.copy(data.pos);
    b.userData.dir = new THREE.Vector3(data.dir.x, data.dir.y, data.dir.z);
    b.userData.life = 100;
    scene.add(b);
    bullets.push(b);
}

function updateBullets() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.position.add(b.userData.dir.clone().multiplyScalar(CONFIG.BULLET_SPEED));
        b.userData.life--;
        if (b.userData.life <= 0) {
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
            const mat = new THREE.MeshStandardMaterial({ color: data[id].color });
            const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 4, 8), mat);
            body.position.y = 0.9;
            group.add(body);
            group.userData.id = id;
            body.userData.id = id;
            scene.add(group);
            players[id] = { mesh: group, body: body };
        }
        const p = data[id];
        players[id].mesh.position.set(p.x, p.y - 1.7, p.z);
        players[id].mesh.rotation.y = p.ry;
        if (p.hp <= 0) players[id].mesh.visible = false;
        else players[id].mesh.visible = true;
    });

    Object.keys(players).forEach(id => {
        if (!data[id]) {
            scene.remove(players[id].mesh);
            delete players[id];
        }
    });
}

function updateHUDStats() {
    document.getElementById('ammo-count').innerText = myStats.ammo;
    document.getElementById('hp-fill').style.width = myStats.hp + "%";
}

function addKillFeed(data) {
    const feed = document.getElementById('kill-feed');
    const msg = document.createElement('div');
    msg.innerHTML = `<span style="color:#ff0055">${data.killer}</span> <i class="fas fa-crosshairs"></i> ${data.victim}`;
    feed.prepend(msg);
    setTimeout(() => msg.remove(), 5000);
}

// Mobile Buttons
document.getElementById('fire-btn').ontouchstart = (e) => { e.preventDefault(); shoot(); };
document.getElementById('reload-btn').ontouchstart = (e) => { e.preventDefault(); reload(); };

window.onresize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
};
