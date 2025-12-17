// --- SUNUCU BAĞLANTISI ---
const socket = io("https://saskioyunu.onrender.com");
let myId, players = {}, otherPlayers = {};
let isMobile = /Mobi|Android/i.test(navigator.userAgent);

// --- 3D SAHNE AYARLARI ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);
scene.fog = new THREE.Fog(0x1a1a1a, 10, 50);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// IŞIKLANDIRMA
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
scene.add(hemiLight);

// HARİTA TASARIMI (Siperler ve Zemin)
const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({color: 0x222222}));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

function addCrate(x, z) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({color: 0x555555}));
    box.position.set(x, 1, z);
    scene.add(box);
}
for(let i=0; i<20; i++) addCrate(Math.random()*60-30, Math.random()*60-30);

// KARAKTER MODELİ (İnsan Formu)
function createModel(color) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1, 4, 8), new THREE.MeshStandardMaterial({color}));
    body.position.y = 1;
    group.add(body);
    return group;
}

const player = createModel(0x00ff00);
scene.add(player);

// --- KONTROLLER (PC & MOBİL) ---
let keys = {}, yaw = 0, pitch = 0;
window.onkeydown = (e) => keys[e.key.toLowerCase()] = true;
window.onkeyup = (e) => keys[e.key.toLowerCase()] = false;

// PC Fare ile Bakış
document.body.onclick = () => { if(!isMobile) renderer.domElement.requestPointerLock(); };
window.onmousemove = (e) => {
    if (document.pointerLockElement) {
        yaw -= e.movementX * 0.003;
        pitch -= e.movementY * 0.003;
        pitch = Math.max(-1.4, Math.min(1.4, pitch));
    }
};

// --- MULTIPLAYER SENKRONİZASYON ---
socket.on('state', (serverPlayers) => {
    for (let id in serverPlayers) {
        if (id === socket.id) continue;
        if (!otherPlayers[id]) {
            otherPlayers[id] = createModel(0xff0000); // Rakip Kırmızı
            scene.add(otherPlayers[id]);
        }
        // Yumuşak Hareket (Interpolation)
        otherPlayers[id].position.lerp(new THREE.Vector3(serverPlayers[id].pos.x, serverPlayers[id].pos.y, serverPlayers[id].pos.z), 0.2);
        otherPlayers[id].rotation.y = serverPlayers[id].rot;
    }
    // Ayrılan oyuncuları sil
    for (let id in otherPlayers) {
        if (!serverPlayers[id]) {
            scene.remove(otherPlayers[id]);
            delete otherPlayers[id];
        }
    }
});

// --- OYUN DÖNGÜSÜ ---
function animate() {
    requestAnimationFrame(animate);
    
    // PC Hareket Mantığı
    const speed = 0.15;
    const direction = new THREE.Vector3();
    if (keys['w']) direction.z -= speed;
    if (keys['s']) direction.z += speed;
    if (keys['a']) direction.x -= speed;
    if (keys['d']) direction.x += speed;

    player.rotation.y = yaw;
    player.translateOnAxis(direction.normalize(), speed);

    // Kamera Takibi (TPS/PUBG Style)
    const cameraOffset = new THREE.Vector3(0, 2.5, 5).applyQuaternion(player.quaternion);
    camera.position.lerp(player.position.clone().add(cameraOffset), 0.1);
    camera.lookAt(player.position.x, player.position.y + 1.5, player.position.z);

    // Sunucuya veri gönder
    socket.emit('move', { pos: player.position, rot: player.rotation.y });

    renderer.render(scene, camera);
}

socket.on('connect', () => {
    document.getElementById('loader').style.display = 'none';
    document.getElementById('ui').style.display = 'block';
    animate();
});
