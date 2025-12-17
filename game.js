import * as THREE from 'three';

const socket = io("https://saskioyunu.onrender.com");
let tg = window.Telegram.WebApp;
let userData = {
    id: tg.initDataUnsafe?.user?.id || "Guest_" + Math.floor(Math.random()*1000),
    name: tg.initDataUnsafe?.user?.first_name || "Ziyaretçi",
    photo: tg.initDataUnsafe?.user?.photo_url || "default.png"
};

// Lobi Bilgilerini Güncelle
document.getElementById('user-name').innerText = userData.name;
document.getElementById('user-avatar').src = userData.photo;

// 3D SAHNE KURULUMU
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505);
scene.fog = new THREE.Fog(0x050505, 5, 25);

// LABİRENT OLUŞTURUCU (Professional Map)
function createMaze() {
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.1 });
    for(let i=0; i<20; i++) {
        const h = Math.random() * 4 + 1;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(4, h, 1), wallMat);
        wall.position.set(Math.random()*40-20, h/2, Math.random()*40-20);
        scene.add(wall);
    }
    // Zemin
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({color: 0x111111}));
    floor.rotation.x = -Math.PI/2;
    scene.add(floor);
}

// ODA KURMA BUTONU
document.getElementById('createRoom').onclick = () => {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('gameCanvas').style.display = 'block';
    startGame();
};

function startGame() {
    createMaze();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas'), antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Işıklar
    const light = new THREE.PointLight(0x4facfe, 2, 50);
    scene.add(light);

    function animate() {
        requestAnimationFrame(animate);
        // Socket üzerinden veri gönderimi: socket.emit('move', {id: userData.id, x: ...});
        renderer.render(scene, camera);
    }
    animate();
}
