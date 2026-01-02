// Telegram WebApp
const tg = window.Telegram.WebApp;
tg.expand();

// Oyun durumları
const GameState = {
    MENU: 'menu',
    LOADING: 'loading',
    PLAYING: 'playing',
    PAUSED: 'paused'
};

// Blok tipleri
const BlockType = {
    GRASS: {id: 1, name: 'Çim', color: 0x7cfc00, icon: '🌿'},
    DIRT: {id: 2, name: 'Toprak', color: 0x8b4513, icon: '🟤'},
    STONE: {id: 3, name: 'Taş', color: 0x808080, icon: '🪨'},
    WOOD: {id: 4, name: 'Odun', color: 0x8b4513, icon: '🪵'},
    LEAVES: {id: 5, name: 'Yaprak', color: 0x228b22, icon: '🍃'},
    SAND: {id: 6, name: 'Kum', color: 0xf4e542, icon: '🏖️'},
    WATER: {id: 7, name: 'Su', color: 0x1e90ff, icon: '💧', transparent: true},
    GLASS: {id: 8, name: 'Cam', color: 0x87ceeb, icon: '🔲', transparent: true},
    BRICK: {id: 9, name: 'Tuğla', color: 0xb22222, icon: '🧱'},
    COBBLESTONE: {id: 10, name: 'Kırık Taş', color: 0x696969, icon: '🪨'},
    GOLD: {id: 11, name: 'Altın', color: 0xffd700, icon: '💰'},
    DIAMOND: {id: 12, name: 'Elmas', color: 0x00ffff, icon: '💎'},
    BEDROCK: {id: 13, name: 'Kaya', color: 0x1a1a1a, icon: '⛰️', unbreakable: true}
};

let currentState = GameState.LOADING;
let scene, camera, renderer, controls;
let world = {};
let player = null;
let socket = null;
let clock = new THREE.Clock();
let deltaTime = 0;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let selectedBlock = BlockType.GRASS;
let hotbarIndex = 0;
let inventory = {};
let isInventoryOpen = false;
let isChatOpen = false;
let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
let gameInitialized = false;

// Oyuncu istatistikleri
let playerStats = {
    health: 100,
    hunger: 100,
    blocks: 0,
    xp: 0
};

// Oyun kontrolleri
const keys = {};
const mouseButtons = {};

// Hotbar slotları
const hotbarSlots = [
    BlockType.GRASS,
    BlockType.DIRT,
    BlockType.STONE,
    BlockType.WOOD,
    BlockType.SAND,
    BlockType.BRICK,
    BlockType.GLASS,
    BlockType.WATER,
    BlockType.GOLD
];

// Sayfa yüklendiğinde
window.addEventListener('load', () => {
    console.log('Sayfa yüklendi, oyun başlatılıyor...');
    initGame();
});

// Hata yakalama
window.addEventListener('error', (e) => {
    console.error('Oyun hatası:', e.error);
    document.getElementById('loading-screen').innerHTML = `
        <h2 style="color: #ff4444;">Hata Oluştu!</h2>
        <p>${e.message}</p>
        <button onclick="location.reload()" style="padding: 10px 20px; background: #00b4d8; color: white; border: none; border-radius: 5px; margin-top: 20px;">
            Tekrar Dene
        </button>
    `;
});

// Telegram WebApp hazır olduğunda
Telegram.WebApp.ready();

// Oyun başlatma
function initGame() {
    console.log('initGame() çalıştı');
    
    try {
        // Three.js kontrolü
        if (!window.THREE) {
            throw new Error('Three.js kütüphanesi yüklenemedi!');
        }
        
        // Canvas kontrolü
        const canvas = document.getElementById('game-canvas');
        if (!canvas) {
            throw new Error('Canvas element bulunamadı!');
        }
        
        // Three.js sahnesi
        scene = new THREE.Scene();
        scene.fog = new THREE.Fog(0x87CEEB, 10, 200);
        
        // Kamera
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 20, 10);
        
        // Renderer
        renderer = new THREE.WebGLRenderer({ 
            canvas: canvas,
            antialias: true,
            alpha: true
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        console.log('Renderer oluşturuldu');
        
        // Işıklandırma
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(100, 100, 50);
        directionalLight.castShadow = true;
        scene.add(directionalLight);
        
        // Gökyüzü
        const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
        const skyMaterial = new THREE.MeshBasicMaterial({
            color: 0x87CEEB,
            side: THREE.BackSide
        });
        const sky = new THREE.Mesh(skyGeometry, skyMaterial);
        scene.add(sky);
        
        // Güneş
        const sunGeometry = new THREE.SphereGeometry(20, 32, 32);
        const sunMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffd700,
            transparent: true,
            opacity: 0.8
        });
        const sun = new THREE.Mesh(sunGeometry, sunMaterial);
        sun.position.set(200, 150, -100);
        scene.add(sun);
        
        console.log('Temel sahne oluşturuldu');
        
        // Dünya oluştur (basit test dünyası)
        createTestWorld();
        
        // UI oluştur
        createHotbar();
        
        // Telegram kullanıcı bilgileri
        try {
            const user = tg.initDataUnsafe?.user;
            if (user) {
                document.getElementById('username').textContent = user.first_name || 'Madenci';
                if (user.photo_url) {
                    document.getElementById('profile-picture').src = user.photo_url;
                }
            }
        } catch (e) {
            console.log('Telegram user bilgisi alınamadı:', e);
        }
        
        // Test render
        renderer.render(scene, camera);
        
        // Menüyü göster
        setTimeout(() => {
            console.log('Menü gösteriliyor...');
            document.getElementById('loading-screen').style.display = 'none';
            document.getElementById('main-menu').style.display = 'flex';
            currentState = GameState.MENU;
            gameInitialized = true;
            
            // Test animasyonu
            animate();
        }, 1000);
        
    } catch (error) {
        console.error('Oyun başlatma hatası:', error);
        document.getElementById('loading-screen').innerHTML = `
            <h2 style="color: #ff4444;">Başlatma Hatası!</h2>
            <p>${error.message}</p>
            <p style="font-size: 12px; margin-top: 10px;">${error.stack}</p>
            <button onclick="location.reload()" style="padding: 10px 20px; background: #00b4d8; color: white; border: none; border-radius: 5px; margin-top: 20px;">
                Tekrar Dene
            </button>
        `;
    }
}

// Basit test dünyası oluştur
function createTestWorld() {
    console.log('Test dünyası oluşturuluyor...');
    
    // Zemin
    for (let x = -5; x <= 5; x++) {
        for (let z = -5; z <= 5; z++) {
            addBlock(x, -1, z, BlockType.GRASS);
        }
    }
    
    // Bazı test blokları
    addBlock(0, 0, 0, BlockType.DIRT);
    addBlock(2, 0, 0, BlockType.STONE);
    addBlock(0, 0, 2, BlockType.WOOD);
    addBlock(-2, 0, 0, BlockType.SAND);
    addBlock(0, 0, -2, BlockType.BRICK);
    addBlock(3, 1, 3, BlockType.GOLD);
    addBlock(-3, 1, -3, BlockType.DIAMOND);
    
    // Su
    addBlock(4, 0, 4, BlockType.WATER);
    
    console.log('Test dünyası oluşturuldu');
}

function addBlock(x, y, z, type) {
    const key = `${x},${y},${z}`;
    
    if (world[key]) return false;
    
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    
    // Şeffaf bloklar için farklı materyal
    let material;
    if (type.transparent) {
        material = new THREE.MeshPhongMaterial({
            color: type.color,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });
    } else {
        material = new THREE.MeshPhongMaterial({ 
            color: type.color 
        });
    }
    
    const cube = new THREE.Mesh(geometry, material);
    cube.position.set(x + 0.5, y + 0.5, z + 0.5);
    cube.castShadow = true;
    cube.receiveShadow = true;
    cube.userData = { type: type, x: x, y: y, z: z };
    
    scene.add(cube);
    
    world[key] = {
        mesh: cube,
        type: type,
        x: x,
        y: y,
        z: z
    };
    
    playerStats.blocks++;
    
    return true;
}

function removeBlock(x, y, z) {
    const key = `${x},${y},${z}`;
    
    if (!world[key]) return false;
    
    const block = world[key];
    
    // Kırılamaz blok kontrolü
    if (block.type.unbreakable) {
        addChatMessage("Bu blok kırılamaz!");
        return false;
    }
    
    // Bloku kaldır
    scene.remove(block.mesh);
    block.mesh.geometry.dispose();
    block.mesh.material.dispose();
    
    delete world[key];
    
    // Envantere ekle
    if (!inventory[block.type.id]) {
        inventory[block.type.id] = {
            type: block.type,
            count: 1
        };
    } else {
        inventory[block.type.id].count++;
    }
    
    updateInventory();
    
    return true;
}

function getBlock(x, y, z) {
    return world[`${x},${y},${z}`];
}

// UI Fonksiyonları
function createHotbar() {
    const hotbar = document.getElementById('hotbar');
    if (!hotbar) return;
    
    hotbar.innerHTML = '';
    
    hotbarSlots.forEach((block, index) => {
        const slot = document.createElement('div');
        slot.className = `hotbar-slot ${index === hotbarIndex ? 'selected' : ''}`;
        slot.innerHTML = `
            <div class="block-icon">${block.icon}</div>
            <div class="slot-number">${index + 1}</div>
        `;
        slot.addEventListener('click', () => selectHotbarSlot(index));
        
        hotbar.appendChild(slot);
    });
}

function selectHotbarSlot(index) {
    if (index >= 0 && index < hotbarSlots.length) {
        hotbarIndex = index;
        selectedBlock = hotbarSlots[index];
        
        // Hotbar güncelleme
        document.querySelectorAll('.hotbar-slot').forEach((slot, i) => {
            if (i === index) {
                slot.classList.add('selected');
            } else {
                slot.classList.remove('selected');
            }
        });
    }
}

function toggleInventory() {
    isInventoryOpen = !isInventoryOpen;
    const inventoryEl = document.getElementById('inventory');
    
    if (isInventoryOpen) {
        inventoryEl.style.display = 'flex';
        updateInventory();
        if (controls) controls.unlock();
    } else {
        inventoryEl.style.display = 'none';
        if (controls && currentState === GameState.PLAYING) controls.lock();
    }
}

function updateInventory() {
    // Envanter satırlarını temizle
    for (let i = 1; i <= 3; i++) {
        const row = document.getElementById(`inventory-row-${i}`);
        if (row) row.innerHTML = '';
    }
    
    // Envanteri doldur
    let slotIndex = 0;
    Object.values(inventory).forEach(item => {
        const row = Math.floor(slotIndex / 9) + 1;
        const rowElement = document.getElementById(`inventory-row-${row}`);
        
        if (rowElement) {
            const slot = document.createElement('div');
            slot.className = 'inventory-slot';
            slot.innerHTML = `
                <div style="font-size: 24px">${item.type.icon}</div>
                <div style="font-size: 10px; position: absolute; bottom: 2px; right: 2px;">${item.count}</div>
            `;
            slot.addEventListener('click', () => {
                // Bu blok tipini hotbar'a ekle
                const emptySlot = hotbarSlots.findIndex(slot => !slot);
                if (emptySlot !== -1) {
                    hotbarSlots[emptySlot] = item.type;
                    createHotbar();
                    selectHotbarSlot(emptySlot);
                }
            });
            
            rowElement.appendChild(slot);
            slotIndex++;
        }
    });
}

function addChatMessage(message) {
    const chat = document.getElementById('chat');
    if (!chat) return;
    
    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    messageElement.textContent = message;
    
    chat.appendChild(messageElement);
    chat.scrollTop = chat.scrollHeight;
    
    // Chat'i göster
    chat.style.display = 'flex';
    setTimeout(() => {
        if (!isChatOpen && chat.children.length > 10) {
            chat.style.display = 'none';
        }
    }, 5000);
}

function updateStats() {
    document.getElementById('health-value').textContent = Math.floor(playerStats.health);
    document.getElementById('hunger-value').textContent = Math.floor(playerStats.hunger);
    document.getElementById('block-count').textContent = playerStats.blocks;
}

// Oyun başlatma
function startGame() {
    console.log('startGame() çalıştı');
    
    try {
        currentState = GameState.PLAYING;
        
        // Oyuncu oluştur
        player = new Player();
        
        // Ekranları göster/gizle
        document.getElementById('main-menu').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        document.getElementById('hud').style.display = 'block';
        document.getElementById('stats').style.display = 'block';
        document.getElementById('crosshair').style.display = 'block';
        
        if (isMobile) {
            document.getElementById('mobile-controls').style.display = 'flex';
        }
        
        // İlk mesaj
        addChatMessage('BlockCraft başladı! W, A, S, D ile hareket et.');
        addChatMessage('Sol tık: Blok kır | Sağ tık: Blok ekle');
        addChatMessage('E: Envanter | T: Sohbet | ESC: Duraklat');
        
    } catch (error) {
        console.error('Oyun başlatma hatası:', error);
        addChatMessage(`Hata: ${error.message}`);
    }
}

// Oyuncu sınıfı
class Player {
    constructor() {
        console.log('Oyuncu oluşturuluyor...');
        
        this.position = new THREE.Vector3(0, 5, 5);
        this.velocity = new THREE.Vector3();
        this.rotation = new THREE.Euler(0, 0, 0, 'YXZ');
        this.speed = 5;
        this.jumpForce = 8;
        this.height = 1.8;
        this.radius = 0.5;
        this.onGround = false;
        this.cameraHeight = 1.6;
        this.jumpPressed = false;
        
        // Kamera
        camera.position.copy(this.position);
        camera.position.y += this.cameraHeight;
        camera.rotation.set(this.rotation.x, this.rotation.y, 0);
        
        // FPS kontrolleri
        if (!isMobile && THREE.PointerLockControls) {
            try {
                controls = new THREE.PointerLockControls(camera, document.body);
                scene.add(controls.getObject());
                console.log('PointerLockControls oluşturuldu');
            } catch (e) {
                console.log('PointerLockControls oluşturulamadı:', e);
            }
        }
        
        this.setupEventListeners();
        console.log('Oyuncu oluşturuldu');
    }
    
    setupEventListeners() {
        // Klavye
        document.addEventListener('keydown', (e) => {
            keys[e.code] = true;
            
            // Hotbar seçimi
            if (e.code >= 'Digit1' && e.code <= 'Digit9') {
                const index = parseInt(e.code[5]) - 1;
                selectHotbarSlot(index);
            }
            
            // Envanter
            if (e.code === 'KeyE') {
                toggleInventory();
                e.preventDefault();
            }
            
            // Sohbet
            if (e.code === 'KeyT') {
                openChat();
                e.preventDefault();
            }
            
            // Duraklatma
            if (e.code === 'Escape') {
                togglePause();
                e.preventDefault();
            }
        });
        
        document.addEventListener('keyup', (e) => {
            keys[e.code] = false;
        });
        
        // Mouse
        document.addEventListener('mousedown', (e) => {
            mouseButtons[e.button] = true;
            e.preventDefault();
        });
        
        document.addEventListener('mouseup', (e) => {
            mouseButtons[e.button] = false;
            e.preventDefault();
        });
        
        if (!isMobile) {
            document.addEventListener('click', () => {
                if (controls && !controls.isLocked && currentState === GameState.PLAYING) {
                    controls.lock();
                }
            });
            
            document.addEventListener('mousemove', (e) => {
                if (controls && controls.isLocked) {
                    const movementX = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
                    const movementY = e.movementY || e.mozMovementY || e.webkitMovementY || 0;
                    
                    this.rotation.y -= movementX * 0.002;
                    this.rotation.x -= movementY * 0.002;
                    this.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.rotation.x));
                    
                    camera.rotation.set(this.rotation.x, this.rotation.y, 0);
                }
            });
        }
    }
    
    update(deltaTime) {
        if (currentState !== GameState.PLAYING) return;
        if (isInventoryOpen || isChatOpen) return;
        
        // Hareket
        const moveVector = new THREE.Vector3();
        
        if (keys['KeyW'] || keys['ArrowUp']) moveVector.z -= 1;
        if (keys['KeyS'] || keys['ArrowDown']) moveVector.z += 1;
        if (keys['KeyA'] || keys['ArrowLeft']) moveVector.x -= 1;
        if (keys['KeyD'] || keys['ArrowRight']) moveVector.x += 1;
        
        // Normalize ve hız uygula
        if (moveVector.length() > 0) {
            moveVector.normalize();
            
            // Kameraya göre yönlendir
            const angle = this.rotation.y;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            
            const x = moveVector.x * cos - moveVector.z * sin;
            const z = moveVector.x * sin + moveVector.z * cos;
            
            this.velocity.x = x * this.speed;
            this.velocity.z = z * this.speed;
        } else {
            this.velocity.x *= 0.8;
            this.velocity.z *= 0.8;
        }
        
        // Zıplama
        if ((keys['Space'] || this.jumpPressed) && this.onGround) {
            this.velocity.y = this.jumpForce;
            this.onGround = false;
        }
        
        // Yerçekimi
        this.velocity.y -= 9.81 * deltaTime;
        
        // Basit yer tespiti
        const groundY = Math.floor(this.position.y);
        const blockBelow = getBlock(
            Math.floor(this.position.x),
            groundY - 1,
            Math.floor(this.position.z)
        );
        
        if (blockBelow && this.position.y - groundY < 0.2) {
            this.position.y = groundY + 0.1;
            this.velocity.y = 0;
            this.onGround = true;
        } else {
            this.onGround = false;
        }
        
        // Pozisyon güncelleme
        this.position.add(this.velocity.clone().multiplyScalar(deltaTime));
        
        // Kamera pozisyonu
        camera.position.copy(this.position);
        camera.position.y += this.cameraHeight;
        
        // Blok etkileşimi
        this.handleBlockInteraction();
    }
    
    handleBlockInteraction() {
        if (currentState !== GameState.PLAYING) return;
        
        // Raycasting ile blok seçimi
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const intersects = raycaster.intersectObjects(scene.children, true);
        
        if (intersects.length > 0) {
            const intersect = intersects[0];
            const point = intersect.point.clone();
            const normal = intersect.face.normal.clone();
            
            // Blok pozisyonunu hesapla
            const blockPos = new THREE.Vector3(
                Math.floor(point.x - normal.x * 0.1),
                Math.floor(point.y - normal.y * 0.1),
                Math.floor(point.z - normal.z * 0.1)
            );
            
            // Blok bilgisini göster
            const block = getBlock(blockPos.x, blockPos.y, blockPos.z);
            if (block) {
                const blockInfo = document.getElementById('block-info');
                if (blockInfo) {
                    blockInfo.innerHTML = `
                        ${block.type.icon} ${block.type.name}<br>
                        X: ${blockPos.x} Y: ${blockPos.y} Z: ${blockPos.z}
                    `;
                    blockInfo.style.display = 'block';
                }
            }
            
            // Sol tık - blok kaldırma
            if (mouseButtons[0]) {
                removeBlock(blockPos.x, blockPos.y, blockPos.z);
                mouseButtons[0] = false;
            }
            
            // Sağ tık - blok ekleme
            if (mouseButtons[2]) {
                const placePos = new THREE.Vector3(
                    Math.floor(point.x + normal.x * 0.1),
                    Math.floor(point.y + normal.y * 0.1),
                    Math.floor(point.z + normal.z * 0.1)
                );
                
                // Oyuncu pozisyonunu kontrol et
                const playerMin = new THREE.Vector3(
                    Math.floor(this.position.x - 0.5),
                    Math.floor(this.position.y),
                    Math.floor(this.position.z - 0.5)
                );
                const playerMax = new THREE.Vector3(
                    Math.floor(this.position.x + 0.5),
                    Math.floor(this.position.y + 2),
                    Math.floor(this.position.z + 0.5)
                );
                
                if (!(
                    placePos.x >= playerMin.x && placePos.x <= playerMax.x &&
                    placePos.y >= playerMin.y && placePos.y <= playerMax.y &&
                    placePos.z >= playerMin.z && placePos.z <= playerMax.z
                )) {
                    addBlock(placePos.x, placePos.y, placePos.z, selectedBlock);
                }
                mouseButtons[2] = false;
            }
        } else {
            const blockInfo = document.getElementById('block-info');
            if (blockInfo) {
                blockInfo.style.display = 'none';
            }
        }
    }
}

// Diğer fonksiyonlar
function openChat() {
    isChatOpen = true;
    const chatInput = document.getElementById('chat-input');
    chatInput.style.display = 'block';
    chatInput.focus();
    
    if (controls) controls.unlock();
}

function closeChat() {
    isChatOpen = false;
    const chatInput = document.getElementById('chat-input');
    chatInput.style.display = 'none';
    chatInput.value = '';
    
    if (controls && currentState === GameState.PLAYING) controls.lock();
}

function togglePause() {
    if (currentState === GameState.PLAYING) {
        currentState = GameState.PAUSED;
        document.getElementById('pause-menu').style.display = 'flex';
        if (controls) controls.unlock();
    } else if (currentState === GameState.PAUSED) {
        currentState = GameState.PLAYING;
        document.getElementById('pause-menu').style.display = 'none';
        if (controls) controls.lock();
    }
}

// Pencere boyutu değişikliği
function onWindowResize() {
    if (!camera || !renderer) return;
    
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', onWindowResize);

// Oyun döngüsü
let frameCount = 0;
let lastTime = performance.now();
let fps = 0;

function animate() {
    requestAnimationFrame(animate);
    deltaTime = clock.getDelta();
    
    if (currentState === GameState.PLAYING && player) {
        player.update(deltaTime);
        
        // FPS hesapla
        frameCount++;
        const currentTime = performance.now();
        if (currentTime - lastTime >= 1000) {
            fps = frameCount;
            frameCount = 0;
            lastTime = currentTime;
            
            const fpsCounter = document.getElementById('fps-counter');
            if (fpsCounter) {
                fpsCounter.textContent = fps;
            }
        }
    }
    
    // Render
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

// Menü event listener'ları
document.getElementById('play-single')?.addEventListener('click', () => {
    console.log('Tek oyunculu mod başlatılıyor...');
    startGame();
});

document.getElementById('play-multi')?.addEventListener('click', () => {
    addChatMessage("Çok oyunculu mod yakında eklenecek!");
});

document.getElementById('resume-btn')?.addEventListener('click', togglePause);
document.getElementById('quit-btn')?.addEventListener('click', () => {
    location.reload();
});

// Sohbet input event'i
document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const message = e.target.value.trim();
        if (message) {
            addChatMessage(`Sen: ${message}`);
            e.target.value = '';
        }
        closeChat();
    }
});

document.getElementById('chat-input')?.addEventListener('blur', closeChat);

// Mobil kontroller
if (isMobile) {
    document.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            // Sol tık
            mouseButtons[0] = true;
            setTimeout(() => mouseButtons[0] = false, 100);
        } else if (e.touches.length === 2) {
            // Sağ tık
            mouseButtons[2] = true;
            setTimeout(() => mouseButtons[2] = false, 100);
        }
    });
}

// Test için: Oyun başladığında render et
setTimeout(() => {
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}, 100);
