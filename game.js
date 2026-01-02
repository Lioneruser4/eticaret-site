// Telegram WebApp başlatma
const tg = window.Telegram.WebApp;
tg.expand();

// Oyun durumları
const GameState = {
    MENU: 'menu',
    LOADING: 'loading',
    ROOM_CREATION: 'room_creation',
    TEAM_SELECTION: 'team_selection',
    PLAYING: 'playing',
    ENDED: 'ended'
};

let currentState = GameState.LOADING;
let socket = null;
let playerId = null;
let roomId = null;
let selectedTeam = null;
let gameTime = 10;
let players = {};
let ball = null;
let scene, camera, renderer, controls;
let clock = new THREE.Clock();
let deltaTime = 0;
let joystickActive = false;
let joystickVector = new THREE.Vector2();
let movementVector = new THREE.Vector3();

// Ana oyun objeleri
let gameObjects = {
    players: {},
    ball: null,
    field: null,
    goals: {}
};

// Oyuncu kontrolleri
const playerControls = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    shoot: false,
    pass: false,
    mouseX: 0,
    mouseY: 0
};

class Player {
    constructor(id, team, name, isLocal = false) {
        this.id = id;
        this.team = team;
        this.name = name;
        this.isLocal = isLocal;
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.rotation = 0;
        this.animationMixer = null;
        this.animations = {};
        this.currentAnimation = 'idle';
        this.hasBall = false;
        this.stamina = 100;
        this.score = 0;
        
        // 3D model
        this.model = null;
        this.initModel();
    }
    
    initModel() {
        const geometry = new THREE.BoxGeometry(1, 2, 1);
        const material = new THREE.MeshPhongMaterial({ 
            color: this.team === 'blue' ? 0x3498db : 0xe74c3c 
        });
        
        this.model = new THREE.Mesh(geometry, material);
        this.model.castShadow = true;
        scene.add(this.model);
        
        // İsmi göstermek için
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        context.fillStyle = 'white';
        context.font = '24px Arial';
        context.textAlign = 'center';
        context.fillText(this.name, 128, 64);
        
        const texture = new THREE.CanvasTexture(canvas);
        const nameMaterial = new THREE.SpriteMaterial({ map: texture });
        const nameSprite = new THREE.Sprite(nameMaterial);
        nameSprite.position.y = 2.5;
        nameSprite.scale.set(4, 2, 1);
        this.model.add(nameSprite);
    }
    
    update(deltaTime) {
        if (!this.model) return;
        
        // Yerel oyuncu kontrolleri
        if (this.isLocal) {
            this.handleLocalControls(deltaTime);
        }
        
        // Fizik hesaplamaları
        this.applyPhysics(deltaTime);
        
        // Modeli güncelle
        this.model.position.copy(this.position);
        this.model.rotation.y = this.rotation;
        
        // Animasyonları güncelle
        if (this.animationMixer) {
            this.animationMixer.update(deltaTime);
        }
    }
    
    handleLocalControls(deltaTime) {
        const speed = 10;
        
        if (playerControls.forward) {
            this.velocity.z = -speed;
        }
        if (playerControls.backward) {
            this.velocity.z = speed;
        }
        if (playerControls.left) {
            this.velocity.x = -speed;
        }
        if (playerControls.right) {
            this.velocity.x = speed;
        }
        
        if (playerControls.jump && this.position.y <= 1) {
            this.velocity.y = 15;
            playerControls.jump = false;
        }
        
        // Mouse ile dönme
        this.rotation = playerControls.mouseX;
    }
    
    applyPhysics(deltaTime) {
        // Yerçekimi
        this.velocity.y -= 9.81 * deltaTime * 3;
        
        // Sınırlamalar
        const fieldSize = 40;
        this.position.x = THREE.MathUtils.clamp(this.position.x, -fieldSize/2, fieldSize/2);
        this.position.z = THREE.MathUtils.clamp(this.position.z, -fieldSize/2, fieldSize/2);
        
        // Yere çarpma
        if (this.position.y <= 1) {
            this.position.y = 1;
            this.velocity.y = 0;
        }
        
        // Pozisyon güncelleme
        this.position.add(this.velocity.clone().multiplyScalar(deltaTime));
        
        // Sürtünme
        this.velocity.multiplyScalar(0.9);
    }
    
    dispose() {
        if (this.model) {
            scene.remove(this.model);
            this.model.geometry.dispose();
            this.model.material.dispose();
        }
    }
}

class Ball {
    constructor() {
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.rotation = new THREE.Vector3();
        
        // 3D model
        const geometry = new THREE.SphereGeometry(0.5, 32, 32);
        const material = new THREE.MeshPhongMaterial({ 
            color: 0xffffff,
            shininess: 100
        });
        
        this.model = new THREE.Mesh(geometry, material);
        this.model.castShadow = true;
        scene.add(this.model);
        
        // Desen ekle
        const texture = this.createBallTexture();
        material.map = texture;
    }
    
    createBallTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const context = canvas.getContext('2d');
        
        // Futbol topu deseni
        context.fillStyle = 'white';
        context.fillRect(0, 0, 512, 512);
        
        context.fillStyle = 'black';
        context.beginPath();
        context.arc(256, 256, 200, 0, Math.PI * 2);
        context.fill();
        
        context.fillStyle = 'white';
        context.beginPath();
        context.arc(256, 256, 190, 0, Math.PI * 2);
        context.fill();
        
        return new THREE.CanvasTexture(canvas);
    }
    
    update(deltaTime) {
        // Yerçekimi
        this.velocity.y -= 9.81 * deltaTime * 3;
        
        // Zemin sınırlaması
        if (this.position.y <= 0.5) {
            this.position.y = 0.5;
            this.velocity.y *= -0.6; // Zıplama etkisi
            this.velocity.x *= 0.95; // Sürtünme
            this.velocity.z *= 0.95;
        }
        
        // Saha sınırlaması
        const fieldSize = 40;
        if (Math.abs(this.position.x) > fieldSize/2 - 1) {
            this.velocity.x *= -0.8; // Duvardan sekme
            this.position.x = THREE.MathUtils.clamp(this.position.x, -fieldSize/2 + 1, fieldSize/2 - 1);
        }
        
        if (Math.abs(this.position.z) > fieldSize/2 - 1) {
            this.velocity.z *= -0.8;
            this.position.z = THREE.MathUtils.clamp(this.position.z, -fieldSize/2 + 1, fieldSize/2 - 1);
        }
        
        // Pozisyon güncelleme
        this.position.add(this.velocity.clone().multiplyScalar(deltaTime));
        
        // Dönme
        this.rotation.x += this.velocity.z * deltaTime * 10;
        this.rotation.z += this.velocity.x * deltaTime * 10;
        
        // Modeli güncelle
        this.model.position.copy(this.position);
        this.model.rotation.x = this.rotation.x;
        this.model.rotation.z = this.rotation.z;
        
        // Havada sürtünme
        this.velocity.multiplyScalar(0.99);
    }
    
    shoot(power, direction) {
        this.velocity.copy(direction.multiplyScalar(power));
        this.velocity.y = power * 0.3;
    }
    
    dispose() {
        if (this.model) {
            scene.remove(this.model);
            this.model.geometry.dispose();
            this.model.material.dispose();
        }
    }
}

class FootballField {
    constructor() {
        this.group = new THREE.Group();
        scene.add(this.group);
        
        this.createField();
        this.createGoals();
        this.createStadium();
    }
    
    createField() {
        // Zemin
        const groundGeometry = new THREE.PlaneGeometry(80, 120);
        const groundMaterial = new THREE.MeshPhongMaterial({ 
            color: 0x2ecc71,
            shininess: 30
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.group.add(ground);
        
        // Çizgiler
        this.createFieldLines();
        
        // Çim dokusu
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load('https://threejs.org/examples/textures/grass.png', (texture) => {
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(10, 15);
            groundMaterial.map = texture;
            groundMaterial.needsUpdate = true;
        });
    }
    
    createFieldLines() {
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
        
        // Dış çizgiler
        const outerLines = new THREE.BufferGeometry();
        const outerPoints = [
            new THREE.Vector3(-40, 0.1, -60),
            new THREE.Vector3(40, 0.1, -60),
            new THREE.Vector3(40, 0.1, 60),
            new THREE.Vector3(-40, 0.1, 60),
            new THREE.Vector3(-40, 0.1, -60)
        ];
        outerLines.setFromPoints(outerPoints);
        const outerLine = new THREE.Line(outerLines, lineMaterial);
        this.group.add(outerLine);
        
        // Orta çizgi
        const middleLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0.1, -60),
                new THREE.Vector3(0, 0.1, 60)
            ]),
            lineMaterial
        );
        this.group.add(middleLine);
        
        // Orta daire
        const circleGeometry = new THREE.CircleGeometry(9.15, 32);
        circleGeometry.rotateX(-Math.PI / 2);
        const circleMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffffff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.5
        });
        const circle = new THREE.Mesh(circleGeometry, circleMaterial);
        circle.position.y = 0.11;
        this.group.add(circle);
    }
    
    createGoals() {
        // Mavi kale (solda)
        const blueGoal = this.createGoalMesh(0x3498db);
        blueGoal.position.set(0, 4, -59);
        gameObjects.goals.blue = blueGoal;
        this.group.add(blueGoal);
        
        // Kırmızı kale (sağda)
        const redGoal = this.createGoalMesh(0xe74c3c);
        redGoal.position.set(0, 4, 59);
        gameObjects.goals.red = redGoal;
        this.group.add(redGoal);
    }
    
    createGoalMesh(color) {
        const group = new THREE.Group();
        
        // Kale direkleri
        const postMaterial = new THREE.MeshPhongMaterial({ color: color });
        const postGeometry = new THREE.CylinderGeometry(0.3, 0.3, 8);
        
        // Sol direk
        const leftPost = new THREE.Mesh(postGeometry, postMaterial);
        leftPost.position.set(-7.32/2, 4, 0);
        group.add(leftPost);
        
        // Sağ direk
        const rightPost = new THREE.Mesh(postGeometry, postMaterial);
        rightPost.position.set(7.32/2, 4, 0);
        group.add(rightPost);
        
        // Üst direk
        const crossbarGeometry = new THREE.CylinderGeometry(0.3, 0.3, 7.32);
        const crossbar = new THREE.Mesh(crossbarGeometry, postMaterial);
        crossbar.position.set(0, 8, 0);
        crossbar.rotation.z = Math.PI / 2;
        group.add(crossbar);
        
        // Ağ
        const netMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffffff,
            wireframe: true,
            transparent: true,
            opacity: 0.3
        });
        const netGeometry = new THREE.BoxGeometry(7.32, 2.44, 2);
        const net = new THREE.Mesh(netGeometry, netMaterial);
        net.position.set(0, 5, 1);
        group.add(net);
        
        return group;
    }
    
    createStadium() {
        // Tribünler
        const stadiumGeometry = new THREE.BoxGeometry(100, 20, 140);
        const stadiumMaterial = new THREE.MeshPhongMaterial({ 
            color: 0x34495e,
            side: THREE.BackSide
        });
        const stadium = new THREE.Mesh(stadiumGeometry, stadiumMaterial);
        stadium.position.y = -10;
        this.group.add(stadium);
        
        // Işıklandırma
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 100, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        scene.add(directionalLight);
        
        // Spot ışıklar
        for (let i = 0; i < 4; i++) {
            const spotLight = new THREE.SpotLight(0xffffff, 0.5);
            spotLight.position.set(
                (i % 2 === 0 ? -1 : 1) * 60,
                40,
                (i < 2 ? -1 : 1) * 80
            );
            spotLight.angle = Math.PI / 6;
            spotLight.penumbra = 0.1;
            spotLight.decay = 2;
            spotLight.distance = 200;
            spotLight.castShadow = true;
            scene.add(spotLight);
        }
    }
    
    dispose() {
        scene.remove(this.group);
        this.group.traverse((object) => {
            if (object.geometry) object.geometry.dispose();
            if (object.material) object.material.dispose();
        });
    }
}

// Oyun başlatma
function initGame() {
    // Three.js sahnesi
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x87CEEB, 10, 200);
    
    // Kamera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 30, 40);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ 
        canvas: document.getElementById('game-canvas'),
        antialias: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Kontroller
    if (!isMobile()) {
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.minDistance = 20;
        controls.maxDistance = 100;
        controls.maxPolarAngle = Math.PI / 2;
    }
    
    // Oyun sahasını oluştur
    gameObjects.field = new FootballField();
    
    // Topu oluştur
    gameObjects.ball = new Ball();
    
    // Event listener'lar
    setupEventListeners();
    
    // Socket.io bağlantısı
    initSocket();
    
    // Yükleme tamamlandı
    setTimeout(() => {
        document.getElementById('loading-screen').style.display = 'none';
        showMainMenu();
    }, 2000);
}

function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function setupEventListeners() {
    // Klavye kontrolleri
    document.addEventListener('keydown', (e) => {
        switch(e.code) {
            case 'KeyW': playerControls.forward = true; break;
            case 'KeyS': playerControls.backward = true; break;
            case 'KeyA': playerControls.left = true; break;
            case 'KeyD': playerControls.right = true; break;
            case 'Space': playerControls.jump = true; break;
        }
    });
    
    document.addEventListener('keyup', (e) => {
        switch(e.code) {
            case 'KeyW': playerControls.forward = false; break;
            case 'KeyS': playerControls.backward = false; break;
            case 'KeyA': playerControls.left = false; break;
            case 'KeyD': playerControls.right = false; break;
        }
    });
    
    // Mouse kontrolleri
    document.addEventListener('mousemove', (e) => {
        if (!isMobile()) {
            playerControls.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
            playerControls.mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
        }
    });
    
    // Mobil joystick
    const joystickHandle = document.getElementById('joystick-handle');
    const joystickBase = document.querySelector('.joystick-base');
    
    let joystickStartX = 0;
    let joystickStartY = 0;
    let joystickHandleX = 0;
    let joystickHandleY = 0;
    
    joystickHandle.addEventListener('touchstart', (e) => {
        joystickActive = true;
        const touch = e.touches[0];
        const rect = joystickBase.getBoundingClientRect();
        joystickStartX = rect.left + rect.width / 2;
        joystickStartY = rect.top + rect.height / 2;
    });
    
    document.addEventListener('touchmove', (e) => {
        if (!joystickActive) return;
        
        e.preventDefault();
        const touch = e.touches[0];
        
        let deltaX = touch.clientX - joystickStartX;
        let deltaY = touch.clientY - joystickStartY;
        
        const maxDistance = 60;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        if (distance > maxDistance) {
            deltaX = (deltaX / distance) * maxDistance;
            deltaY = (deltaY / distance) * maxDistance;
        }
        
        joystickHandleX = deltaX;
        joystickHandleY = deltaY;
        
        joystickHandle.style.transform = `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px))`;
        
        joystickVector.x = deltaX / maxDistance;
        joystickVector.y = deltaY / maxDistance;
        
        playerControls.forward = joystickVector.y < -0.3;
        playerControls.backward = joystickVector.y > 0.3;
        playerControls.left = joystickVector.x < -0.3;
        playerControls.right = joystickVector.x > 0.3;
    });
    
    document.addEventListener('touchend', (e) => {
        if (joystickActive) {
            joystickActive = false;
            joystickHandle.style.transform = 'translate(-50%, -50%)';
            joystickVector.set(0, 0);
            
            playerControls.forward = false;
            playerControls.backward = false;
            playerControls.left = false;
            playerControls.right = false;
        }
    });
    
    // Mobil butonlar
    document.getElementById('jump-btn').addEventListener('touchstart', (e) => {
        e.preventDefault();
        playerControls.jump = true;
    });
    
    document.getElementById('shoot-btn').addEventListener('touchstart', (e) => {
        e.preventDefault();
        playerControls.shoot = true;
    });
    
    document.getElementById('pass-btn').addEventListener('touchstart', (e) => {
        e.preventDefault();
        playerControls.pass = true;
    });
    
    // Pencere boyutu değişikliği
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
    
    // Menü butonları
    document.getElementById('create-room-btn').addEventListener('click', showRoomCreation);
    document.getElementById('join-room-btn').addEventListener('click', showRoomList);
    document.getElementById('quick-play-btn').addEventListener('click', quickPlay);
    document.getElementById('cancel-create').addEventListener('click', hideRoomCreation);
    
    // Oda kurma butonları
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('selected'));
            e.target.classList.add('selected');
            gameTime = parseInt(e.target.dataset.time);
        });
    });
    
    document.getElementById('create-room-confirm').addEventListener('click', createRoom);
    
    // Takım seçimi
    document.querySelectorAll('.team-option').forEach(option => {
        option.addEventListener('click', (e) => {
            selectedTeam = e.currentTarget.dataset.team;
            joinTeam(selectedTeam);
        });
    });
}

function initSocket() {
    // Render.io için bağlantı
    socket = io('https://saskioyunu.onrender.com');
    
    socket.on('connect', () => {
        console.log('Sunucuya bağlandı');
        playerId = socket.id;
        
        // Telegram'dan kullanıcı bilgilerini al
        const user = tg.initDataUnsafe.user;
        if (user) {
            document.getElementById('username').textContent = user.first_name || 'Oyuncu';
            if (user.photo_url) {
                document.getElementById('profile-picture').src = user.photo_url;
            }
        }
    });
    
    socket.on('roomCreated', (data) => {
        roomId = data.roomId;
        showTeamSelection(data.teams);
    });
    
    socket.on('playerJoined', (data) => {
        updateTeamCounts(data.teams);
    });
    
    socket.on('gameStarted', (data) => {
        startGame(data);
    });
    
    socket.on('playerMoved', (data) => {
        if (players[data.id]) {
            players[data.id].position.set(data.x, data.y, data.z);
            players[data.id].rotation = data.rotation;
        }
    });
    
    socket.on('ballMoved', (data) => {
        if (gameObjects.ball) {
            gameObjects.ball.position.set(data.x, data.y, data.z);
            gameObjects.ball.velocity.set(data.vx, data.vy, data.vz);
        }
    });
    
    socket.on('goalScored', (data) => {
        updateScore(data.team, data.score);
        showGoalAnimation(data.team);
    });
    
    socket.on('gameEnded', (data) => {
        endGame(data.winner);
    });
}

function showMainMenu() {
    currentState = GameState.MENU;
    document.getElementById('main-menu').style.display = 'flex';
}

function showRoomCreation() {
    currentState = GameState.ROOM_CREATION;
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('room-creation-modal').style.display = 'flex';
}

function hideRoomCreation() {
    document.getElementById('room-creation-modal').style.display = 'none';
    showMainMenu();
}

function createRoom() {
    if (!gameTime) {
        alert('Lütfen oyun süresi seçin');
        return;
    }
    
    socket.emit('createRoom', {
        time: gameTime,
        playerName: document.getElementById('username').textContent
    });
    
    hideRoomCreation();
}

function showTeamSelection(teams) {
    currentState = GameState.TEAM_SELECTION;
    document.getElementById('team-selection').style.display = 'flex';
    updateTeamCounts(teams);
}

function updateTeamCounts(teams) {
    document.getElementById('blue-count').textContent = teams.blue.length;
    document.getElementById('red-count').textContent = teams.red.length;
}

function joinTeam(team) {
    socket.emit('joinTeam', {
        roomId: roomId,
        team: team,
        playerId: playerId
    });
    
    document.getElementById('team-selection').style.display = 'none';
}

function startGame(gameData) {
    currentState = GameState.PLAYING;
    
    // Oyun container'ını göster
    document.getElementById('game-container').style.display = 'block';
    document.getElementById('score-board').style.display = 'flex';
    
    // Mobil kontrolleri göster
    if (isMobile()) {
        document.getElementById('mobile-controls').style.display = 'flex';
    }
    
    // Diğer oyuncuları oluştur
    gameData.players.forEach(playerData => {
        if (playerData.id !== playerId) {
            const player = new Player(
                playerData.id,
                playerData.team,
                playerData.name
            );
            player.position.set(playerData.x, playerData.y, playerData.z);
            players[playerData.id] = player;
        }
    });
    
    // Yerel oyuncuyu oluştur
    const localPlayerData = gameData.players.find(p => p.id === playerId);
    if (localPlayerData) {
        const localPlayer = new Player(
            playerId,
            localPlayerData.team,
            localPlayerData.name,
            true
        );
        localPlayer.position.set(localPlayerData.x, localPlayerData.y, localPlayerData.z);
        players[playerId] = localPlayer;
    }
    
    // Skoru güncelle
    updateScore('blue', gameData.scores.blue);
    updateScore('red', gameData.scores.red);
    
    // Oyun döngüsünü başlat
    animate();
}

function updateScore(team, score) {
    if (team === 'blue') {
        document.getElementById('blue-score').textContent = score;
    } else {
        document.getElementById('red-score').textContent = score;
    }
}

function showGoalAnimation(team) {
    // Gol animasyonu
    const goalText = document.createElement('div');
    goalText.style.position = 'fixed';
    goalText.style.top = '50%';
    goalText.style.left = '50%';
    goalText.style.transform = 'translate(-50%, -50%)';
    goalText.style.fontSize = '48px';
    goalText.style.fontWeight = 'bold';
    goalText.style.color = team === 'blue' ? '#3498db' : '#e74c3c';
    goalText.style.zIndex = '1000';
    goalText.style.textShadow = '0 0 10px white';
    goalText.textContent = 'GOOOOOOL!';
    
    document.body.appendChild(goalText);
    
    setTimeout(() => {
        document.body.removeChild(goalText);
    }, 2000);
}

function endGame(winner) {
    currentState = GameState.ENDED;
    
    // Kazanan ekranı
    const winnerScreen = document.createElement('div');
    winnerScreen.style.position = 'fixed';
    winnerScreen.style.top = '0';
    winnerScreen.style.left = '0';
    winnerScreen.style.width = '100%';
    winnerScreen.style.height = '100%';
    winnerScreen.style.background = 'rgba(0,0,0,0.9)';
    winnerScreen.style.display = 'flex';
    winnerScreen.style.flexDirection = 'column';
    winnerScreen.style.justifyContent = 'center';
    winnerScreen.style.alignItems = 'center';
    winnerScreen.style.zIndex = '2000';
    winnerScreen.style.color = 'white';
    
    winnerScreen.innerHTML = `
        <h1 style="font-size: 48px; margin-bottom: 20px;">${winner} TAKIMI KAZANDI!</h1>
        <button id="back-to-menu" style="padding: 15px 30px; font-size: 24px; background: #3498db; color: white; border: none; border-radius: 10px; cursor: pointer;">
            Menüye Dön
        </button>
    `;
    
    document.body.appendChild(winnerScreen);
    
    document.getElementById('back-to-menu').addEventListener('click', () => {
        document.body.removeChild(winnerScreen);
        resetGame();
        showMainMenu();
    });
}

function resetGame() {
    // Tüm oyun objelerini temizle
    Object.values(players).forEach(player => player.dispose());
    players = {};
    
    if (gameObjects.ball) {
        gameObjects.ball.dispose();
        gameObjects.ball = null;
    }
    
    if (gameObjects.field) {
        gameObjects.field.dispose();
        gameObjects.field = null;
    }
    
    // Ekranları gizle
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('score-board').style.display = 'none';
    document.getElementById('mobile-controls').style.display = 'none';
}

function quickPlay() {
    // Hızlı oyun için rastgele odaya katıl
    socket.emit('quickPlay', {
        playerName: document.getElementById('username').textContent
    });
}

function showRoomList() {
    // Oda listesini göster (basit implementasyon)
    alert('Oda listesi özelliği yakında eklenecek!');
}

// Oyun döngüsü
function animate() {
    requestAnimationFrame(animate);
    deltaTime = clock.getDelta();
    
    if (currentState === GameState.PLAYING) {
        // Yerel oyuncuyu güncelle
        if (players[playerId]) {
            players[playerId].update(deltaTime);
            
            // Sunucuya pozisyon gönder
            socket.emit('playerMove', {
                x: players[playerId].position.x,
                y: players[playerId].position.y,
                z: players[playerId].position.z,
                rotation: players[playerId].rotation
            });
            
            // Şut kontrolü
            if (playerControls.shoot) {
                const ball = gameObjects.ball;
                const player = players[playerId];
                const distance = player.position.distanceTo(ball.position);
                
                if (distance < 3) {
                    const shootDirection = new THREE.Vector3(
                        Math.sin(player.rotation),
                        0,
                        -Math.cos(player.rotation)
                    ).normalize();
                    
                    ball.shoot(30, shootDirection);
                    
                    socket.emit('shoot', {
                        direction: {
                            x: shootDirection.x,
                            y: shootDirection.y,
                            z: shootDirection.z
                        },
                        power: 30
                    });
                }
                
                playerControls.shoot = false;
            }
            
            // Pas kontrolü
            if (playerControls.pass) {
                // Pas mekaniği
                playerControls.pass = false;
            }
        }
        
        // Topu güncelle
        if (gameObjects.ball) {
            gameObjects.ball.update(deltaTime);
        }
        
        // Diğer oyuncuları güncelle
        Object.values(players).forEach(player => {
            if (player.id !== playerId) {
                player.update(deltaTime);
            }
        });
        
        // Kamerayı yerel oyuncuyu takip et
        if (players[playerId]) {
            const playerPos = players[playerId].position;
            camera.position.x = playerPos.x;
            camera.position.z = playerPos.z + 15;
            camera.position.y = 10;
            camera.lookAt(playerPos.x, playerPos.y + 2, playerPos.z);
        }
    }
    
    // Render
    renderer.render(scene, camera);
}

// Oyunu başlat
window.addEventListener('load', initGame);

// Telegram WebApp hazır olduğunda
Telegram.WebApp.ready();
