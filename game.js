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

class Player {
    constructor() {
        this.position = new THREE.Vector3(0, 20, 0);
        this.velocity = new THREE.Vector3();
        this.rotation = new THREE.Euler(0, 0, 0, 'YXZ');
        this.speed = 5;
        this.jumpForce = 10;
        this.height = 1.8;
        this.radius = 0.5;
        this.onGround = false;
        this.cameraHeight = 1.6;
        
        // Kamera
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.copy(this.position);
        camera.position.y += this.cameraHeight;
        
        // FPS kontrolleri
        if (!isMobile) {
            controls = new THREE.PointerLockControls(camera, document.body);
            scene.add(controls.getObject());
        }
        
        this.setupEventListeners();
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
            }
            
            // Sohbet
            if (e.code === 'KeyT') {
                openChat();
            }
            
            // Duraklatma
            if (e.code === 'Escape') {
                togglePause();
            }
        });
        
        document.addEventListener('keyup', (e) => {
            keys[e.code] = false;
        });
        
        // Mouse
        document.addEventListener('mousedown', (e) => {
            mouseButtons[e.button] = true;
        });
        
        document.addEventListener('mouseup', (e) => {
            mouseButtons[e.button] = false;
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
        
        // Pencere boyutu
        window.addEventListener('resize', onWindowResize);
        
        // Mobil kontroller
        if (isMobile) {
            setupMobileControls();
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
        this.velocity.y -= 9.81 * deltaTime * 2;
        
        // Çarpışma tespiti
        this.checkCollisions(deltaTime);
        
        // Pozisyon güncelleme
        this.position.add(this.velocity.clone().multiplyScalar(deltaTime));
        
        // Kamera pozisyonu
        camera.position.copy(this.position);
        camera.position.y += this.cameraHeight;
        
        // Blok etkileşimi
        this.handleBlockInteraction();
    }
    
    checkCollisions(deltaTime) {
        const nextPos = this.position.clone().add(this.velocity.clone().multiplyScalar(deltaTime));
        
        // Basit AABB çarpışma tespiti
        const playerBox = {
            min: new THREE.Vector3(
                nextPos.x - this.radius,
                nextPos.y,
                nextPos.z - this.radius
            ),
            max: new THREE.Vector3(
                nextPos.x + this.radius,
                nextPos.y + this.height,
                nextPos.z + this.radius
            )
        };
        
        // Yerde olma kontrolü
        this.onGround = false;
        const groundCheck = Math.floor(this.position.y);
        const blockBelow = getBlock(
            Math.floor(this.position.x),
            groundCheck - 1,
            Math.floor(this.position.z)
        );
        
        if (blockBelow && blockBelow.type !== BlockType.WATER) {
            if (this.position.y - groundCheck < 0.1) {
                this.position.y = groundCheck + 0.1;
                this.velocity.y = 0;
                this.onGround = true;
            }
        }
        
        // Blok çarpışmaları
        for (let x = -1; x <= 1; x++) {
            for (let y = 0; y <= 2; y++) {
                for (let z = -1; z <= 1; z++) {
                    const checkX = Math.floor(this.position.x + x);
                    const checkY = Math.floor(this.position.y + y);
                    const checkZ = Math.floor(this.position.z + z);
                    
                    const block = getBlock(checkX, checkY, checkZ);
                    if (block && block.type !== BlockType.WATER) {
                        const blockBox = {
                            min: new THREE.Vector3(checkX, checkY, checkZ),
                            max: new THREE.Vector3(checkX + 1, checkY + 1, checkZ + 1)
                        };
                        
                        if (this.checkAABBCollision(playerBox, blockBox)) {
                            // Çarpışma çözümü
                            const dx = this.position.x - checkX;
                            const dz = this.position.z - checkZ;
                            
                            if (Math.abs(dx) > Math.abs(dz)) {
                                this.velocity.x = 0;
                                this.position.x += dx > 0 ? 0.1 : -0.1;
                            } else {
                                this.velocity.z = 0;
                                this.position.z += dz > 0 ? 0.1 : -0.1;
                            }
                        }
                    }
                }
            }
        }
    }
    
    checkAABBCollision(box1, box2) {
        return (
            box1.min.x < box2.max.x &&
            box1.max.x > box2.min.x &&
            box1.min.y < box2.max.y &&
            box1.max.y > box2.min.y &&
            box1.min.z < box2.max.z &&
            box1.max.z > box2.min.z
        );
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
                document.getElementById('block-info').innerHTML = `
                    ${block.type.icon} ${block.type.name}<br>
                    X: ${blockPos.x} Y: ${blockPos.y} Z: ${blockPos.z}
                `;
                document.getElementById('block-info').style.display = 'block';
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
            document.getElementById('block-info').style.display = 'none';
        }
    }
}

// Dünya fonksiyonları
function generateWorld() {
    console.log('Dünya oluşturuluyor...');
    
    const worldSize = 32;
    const waterLevel = 10;
    
    for (let x = -worldSize; x < worldSize; x++) {
        for (let z = -worldSize; z < worldSize; z++) {
            // Yükseklik haritası
            const height = Math.floor(
                noise(x * 0.1, z * 0.1) * 5 +
                noise(x * 0.05, z * 0.05) * 10 +
                15
            );
            
            // Blokları oluştur
            for (let y = 0; y <= height; y++) {
                if (y === height) {
                    addBlock(x, y, z, BlockType.GRASS);
                } else if (y > height - 4) {
                    addBlock(x, y, z, BlockType.DIRT);
                } else if (y > 0) {
                    addBlock(x, y, z, BlockType.STONE);
                } else {
                    addBlock(x, y, z, BlockType.BEDROCK);
                }
            }
            
            // Su
            for (let y = 1; y <= waterLevel; y++) {
                if (!getBlock(x, y, z) && y < waterLevel) {
                    addBlock(x, y, z, BlockType.WATER);
                }
            }
            
            // Ağaçlar
            if (Math.random() < 0.02 && height > waterLevel + 2) {
                generateTree(x, height + 1, z);
            }
        }
    }
    
    // Madenler
    generateOres();
    
    console.log('Dünya oluşturuldu!');
}

function noise(x, z) {
    return (Math.sin(x * 0.1) * Math.cos(z * 0.1) + 1) * 0.5;
}

function generateTree(x, y, z) {
    // Gövde
    for (let i = 0; i < 5; i++) {
        addBlock(x, y + i, z, BlockType.WOOD);
    }
    
    // Yapraklar
    for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
            for (let dz = -2; dz <= 2; dz++) {
                const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
                if (distance < 2.5 && !(dx === 0 && dz === 0 && dy >= 0)) {
                    addBlock(x + dx, y + 3 + dy, z + dz, BlockType.LEAVES);
                }
            }
        }
    }
}

function generateOres() {
    const worldSize = 32;
    
    // Kömür
    for (let i = 0; i < 50; i++) {
        const x = Math.floor(Math.random() * worldSize * 2) - worldSize;
        const z = Math.floor(Math.random() * worldSize * 2) - worldSize;
        const y = Math.floor(Math.random() * 15) + 5;
        
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                for (let dz = -2; dz <= 2; dz++) {
                    if (Math.random() < 0.7) {
                        addBlock(x + dx, y + dy, z + dz, BlockType.COBBLESTONE);
                    }
                }
            }
        }
    }
    
    // Altın
    for (let i = 0; i < 10; i++) {
        const x = Math.floor(Math.random() * worldSize * 2) - worldSize;
        const z = Math.floor(Math.random() * worldSize * 2) - worldSize;
        const y = Math.floor(Math.random() * 10) + 5;
        
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (Math.random() < 0.8) {
                        addBlock(x + dx, y + dy, z + dz, BlockType.GOLD);
                    }
                }
            }
        }
    }
    
    // Elmas
    for (let i = 0; i < 3; i++) {
        const x = Math.floor(Math.random() * worldSize * 2) - worldSize;
        const z = Math.floor(Math.random() * worldSize * 2) - worldSize;
        const y = Math.floor(Math.random() * 5) + 5;
        
        addBlock(x, y, z, BlockType.DIAMOND);
    }
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
    updateStats();
    
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

function createHotbar() {
    const hotbar = document.getElementById('hotbar');
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

function toggleInventory() {
    isInventoryOpen = !isInventoryOpen;
    const inventory = document.getElementById('inventory');
    
    if (isInventoryOpen) {
        inventory.style.display = 'flex';
        updateInventory();
        if (controls) controls.unlock();
    } else {
        inventory.style.display = 'none';
        if (controls && currentState === GameState.PLAYING) controls.lock();
    }
}

function updateInventory() {
    // Envanter satırlarını temizle
    for (let i = 1; i <= 3; i++) {
        const row = document.getElementById(`inventory-row-${i}`);
        row.innerHTML = '';
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

function openChat() {
    isChatOpen = true;
    const chatInput = document.getElementById('chat-input');
    chatInput.style.display = 'block';
    chatInput.focus();
    
    if (controls) controls.unlock();
}

function closeChat() {
    isChatOpen = false;
    document.getElementById('chat-input').style.display = 'none';
    document.getElementById('chat-input').value = '';
    
    if (controls && currentState === GameState.PLAYING) controls.lock();
}

function addChatMessage(message) {
    const chat = document.getElementById('chat');
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

function setupMobileControls() {
    const touchArea = document.getElementById('touch-area');
    const jumpBtn = document.getElementById('mobile-jump');
    const actionBtn = document.getElementById('mobile-action');
    const inventoryBtn = document.getElementById('mobile-inventory');
    
    // Dokunmatik kontroller
    let touchStart = { x: 0, y: 0 };
    let currentTouch = { x: 0, y: 0 };
    let isTouching = false;
    
    touchArea.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isTouching = true;
        const touch = e.touches[0];
        touchStart = { x: touch.clientX, y: touch.clientY };
        currentTouch = { x: touch.clientX, y: touch.clientY };
    });
    
    touchArea.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!isTouching) return;
        
        const touch = e.touches[0];
        currentTouch = { x: touch.clientX, y: touch.clientY };
        
        // Kamera döndürme
        const deltaX = (currentTouch.x - touchStart.x) * 0.005;
        const deltaY = (currentTouch.y - touchStart.y) * 0.005;
        
        if (player) {
            player.rotation.y -= deltaX;
            player.rotation.x -= deltaY;
            player.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.rotation.x));
            camera.rotation.set(player.rotation.x, player.rotation.y, 0);
        }
    });
    
    touchArea.addEventListener('touchend', (e) => {
        e.preventDefault();
        isTouching = false;
    });
    
    // Butonlar
    jumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        player.jumpPressed = true;
    });
    
    jumpBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        player.jumpPressed = false;
    });
    
    actionBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        // Sol tık (kaldırma)
        mouseButtons[0] = true;
        setTimeout(() => mouseButtons[0] = false, 100);
    });
    
    actionBtn.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1 || e.detail === 2) {
            // Çift tık veya uzun basma - sağ tık (ekleme)
            mouseButtons[2] = true;
            setTimeout(() => mouseButtons[2] = false, 100);
        }
    });
    
    inventoryBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        toggleInventory();
    });
}

// Oyun başlatma
function initGame() {
    // Sahne
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x87CEEB, 10, 200);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ 
        canvas: document.getElementById('game-canvas'),
        antialias: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Işıklandırma
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
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
    
    // Bulutlar
    for (let i = 0; i < 20; i++) {
        const cloudGeometry = new THREE.SphereGeometry(
            Math.random() * 5 + 3,
            8,
            8
        );
        const cloudMaterial = new THREE.MeshLambertMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8
        });
        const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial);
        cloud.position.set(
            Math.random() * 200 - 100,
            Math.random() * 30 + 50,
            Math.random() * 200 - 100
        );
        scene.add(cloud);
    }
    
    // Dünya oluştur
    generateWorld();
    
    // Oyuncu oluştur
    player = new Player();
    
    // UI oluştur
    createHotbar();
    
    // Telegram kullanıcı bilgileri
    const user = tg.initDataUnsafe.user;
    if (user) {
        document.getElementById('username').textContent = user.first_name || 'Madenci';
        if (user.photo_url) {
            document.getElementById('profile-picture').src = user.photo_url;
        }
        addChatMessage(`Hoş geldin, ${user.first_name}!`);
    }
    
    // Oyun başlatma
    startGame();
}

function startGame() {
    currentState = GameState.PLAYING;
    
    // Ekranları göster/gizle
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    document.getElementById('hud').style.display = 'block';
    document.getElementById('stats').style.display = 'block';
    document.getElementById('chat').style.display = 'flex';
    document.getElementById('crosshair').style.display = 'block';
    
    if (isMobile) {
        document.getElementById('mobile-controls').style.display = 'flex';
    }
    
    // Kontrolleri kilitle
    if (!isMobile && controls) {
        controls.lock();
    }
    
    // Oyun döngüsünü başlat
    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Oyun döngüsü
let frameCount = 0;
let lastTime = performance.now();
let fps = 0;

function animate() {
    requestAnimationFrame(animate);
    deltaTime = clock.getDelta();
    
    if (currentState === GameState.PLAYING) {
        // Oyuncuyu güncelle
        if (player) {
            player.update(deltaTime);
        }
        
        // FPS hesapla
        frameCount++;
        const currentTime = performance.now();
        if (currentTime - lastTime >= 1000) {
            fps = frameCount;
            frameCount = 0;
            lastTime = currentTime;
            
            document.getElementById('fps-counter').textContent = fps;
        }
    }
    
    // Render
    renderer.render(scene, camera);
}

// Event listener'lar
document.getElementById('play-single').addEventListener('click', () => {
    document.getElementById('main-menu').style.display = 'none';
    initGame();
});

document.getElementById('play-multi').addEventListener('click', () => {
    addChatMessage("Çok oyunculu mod yakında eklenecek!");
});

document.getElementById('join-world').addEventListener('click', () => {
    addChatMessage("Dünyaya katılma özelliği geliştiriliyor!");
});

document.getElementById('create-world').addEventListener('click', () => {
    addChatMessage("Yeni dünya oluşturma özelliği yakında!");
});

document.getElementById('settings').addEventListener('click', () => {
    addChatMessage("Ayarlar menüsü geliştiriliyor!");
});

document.getElementById('resume-btn').addEventListener('click', togglePause);
document.getElementById('quit-btn').addEventListener('click', () => {
    location.reload();
});

document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const message = e.target.value.trim();
        if (message) {
            addChatMessage(`Sen: ${message}`);
            e.target.value = '';
        }
        closeChat();
    }
});

document.getElementById('chat-input').addEventListener('blur', closeChat);

// Sayfa yüklendiğinde
window.addEventListener('load', () => {
    setTimeout(() => {
        document.getElementById('loading-screen').style.display = 'none';
        document.getElementById('main-menu').style.display = 'flex';
    }, 2000);
});

// Telefonda tam ekran
if (isMobile) {
    document.documentElement.requestFullscreen?.().catch(console.log);
}

// Telegram hazır olduğunda
Telegram.WebApp.ready();
