// 3D Game Engine using Three.js
class Game3D {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.players = new Map();
        this.deadBodies = new Map();
        this.tasks = new Map();
        this.localPlayer = null;
        this.controls = {
            forward: false,
            backward: false,
            left: false,
            right: false
        };

        this.init();
    }

    init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0e27);
        this.scene.fog = new THREE.Fog(0x0a0e27, 10, 50);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 10, 10);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Lights
        this.setupLights();

        // Map
        this.createMap();

        // Window resize
        window.addEventListener('resize', () => this.onWindowResize());

        console.log('3D Engine initialized');
    }

    setupLights() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        // Directional light
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
        directionalLight.position.set(10, 20, 10);
        directionalLight.castShadow = true;
        directionalLight.shadow.camera.left = -30;
        directionalLight.shadow.camera.right = 30;
        directionalLight.shadow.camera.top = 30;
        directionalLight.shadow.camera.bottom = -30;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);

        // Point lights for atmosphere
        const pointLight1 = new THREE.PointLight(0xff4757, 0.5, 20);
        pointLight1.position.set(-10, 5, -10);
        this.scene.add(pointLight1);

        const pointLight2 = new THREE.PointLight(0x5352ed, 0.5, 20);
        pointLight2.position.set(10, 5, 10);
        this.scene.add(pointLight2);
    }

    createMap() {
        // Floor
        const floorGeometry = new THREE.PlaneGeometry(CONFIG.MAP.WIDTH, CONFIG.MAP.HEIGHT);
        const floorMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1f3a,
            roughness: 0.8,
            metalness: 0.2
        });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Grid
        const gridHelper = new THREE.GridHelper(CONFIG.MAP.WIDTH, 50, 0x2d3561, 0x2d3561);
        gridHelper.position.y = 0.01;
        this.scene.add(gridHelper);

        // Walls and rooms (simplified Among Us map)
        this.createRooms();

        // Tasks
        this.createTaskLocations();
    }

    createRooms() {
        const wallMaterial = new THREE.MeshStandardMaterial({
            color: 0x2d3561,
            roughness: 0.7,
            metalness: 0.3
        });

        // Cafeteria
        this.createRoom(-15, 0, 10, 8, wallMaterial, 'Cafeteria');

        // Weapons
        this.createRoom(-15, 15, 8, 6, wallMaterial, 'Weapons');

        // O2
        this.createRoom(15, 15, 8, 6, wallMaterial, 'O2');

        // Navigation
        this.createRoom(15, 0, 8, 8, wallMaterial, 'Navigation');

        // Shields
        this.createRoom(15, -15, 8, 6, wallMaterial, 'Shields');

        // Communications
        this.createRoom(-15, -15, 8, 6, wallMaterial, 'Communications');

        // Storage
        this.createRoom(0, -15, 10, 6, wallMaterial, 'Storage');

        // Electrical
        this.createRoom(-5, -8, 6, 5, wallMaterial, 'Electrical');

        // Admin
        this.createRoom(5, 5, 6, 6, wallMaterial, 'Admin');

        // MedBay
        this.createRoom(5, -8, 6, 5, wallMaterial, 'MedBay');
    }

    createRoom(x, z, width, depth, material, name) {
        const wallHeight = 3;
        const wallThickness = 0.3;

        // Create walls
        const walls = [
            // North wall
            { x: x, y: wallHeight / 2, z: z - depth / 2, w: width, h: wallHeight, d: wallThickness },
            // South wall
            { x: x, y: wallHeight / 2, z: z + depth / 2, w: width, h: wallHeight, d: wallThickness },
            // East wall
            { x: x + width / 2, y: wallHeight / 2, z: z, w: wallThickness, h: wallHeight, d: depth },
            // West wall
            { x: x - width / 2, y: wallHeight / 2, z: z, w: wallThickness, h: wallHeight, d: depth }
        ];

        walls.forEach(wall => {
            const geometry = new THREE.BoxGeometry(wall.w, wall.h, wall.d);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(wall.x, wall.y, wall.z);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
        });

        // Room label
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;
        context.fillStyle = '#ffffff';
        context.font = 'bold 32px Arial';
        context.textAlign = 'center';
        context.fillText(name, 128, 40);

        const texture = new THREE.CanvasTexture(canvas);
        const labelMaterial = new THREE.SpriteMaterial({ map: texture });
        const label = new THREE.Sprite(labelMaterial);
        label.position.set(x, wallHeight + 1, z);
        label.scale.set(4, 1, 1);
        this.scene.add(label);
    }

    createTaskLocations() {
        const taskPositions = [
            { x: -15, z: 0, type: CONFIG.TASKS.WIRING },
            { x: -15, z: 15, type: CONFIG.TASKS.DOWNLOAD },
            { x: 15, z: 15, type: CONFIG.TASKS.FUEL },
            { x: 15, z: 0, type: CONFIG.TASKS.GARBAGE },
            { x: 15, z: -15, type: CONFIG.TASKS.SCAN },
            { x: -15, z: -15, type: CONFIG.TASKS.ASTEROIDS },
            { x: 0, z: -15, type: CONFIG.TASKS.SHIELDS },
            { x: -5, z: -8, type: CONFIG.TASKS.REACTOR }
        ];

        taskPositions.forEach((pos, index) => {
            const taskId = `task_${index}`;
            const task = this.createTask(pos.x, pos.z, pos.type);
            this.tasks.set(taskId, {
                mesh: task,
                type: pos.type,
                position: { x: pos.x, y: 0, z: pos.z },
                completed: false
            });
        });
    }

    createTask(x, z, type) {
        const geometry = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 32);
        const material = new THREE.MeshStandardMaterial({
            color: 0xfed330,
            emissive: 0xfed330,
            emissiveIntensity: 0.5,
            roughness: 0.3,
            metalness: 0.7
        });
        const task = new THREE.Mesh(geometry, material);
        task.position.set(x, 0.05, z);
        task.castShadow = true;
        this.scene.add(task);

        return task;
    }

    createPlayer(playerId, data) {
        const color = data.color || CONFIG.COLORS[0];

        // Crewmate body (Among Us style)
        const group = new THREE.Group();

        // Body
        const bodyGeometry = new THREE.CapsuleGeometry(0.5, 1, 16, 32);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.5,
            metalness: 0.3
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        // Visor (glass)
        const visorGeometry = new THREE.CircleGeometry(0.3, 32);
        const visorMaterial = new THREE.MeshStandardMaterial({
            color: 0x87ceeb,
            transparent: true,
            opacity: 0.8,
            roughness: 0.1,
            metalness: 0.9
        });
        const visor = new THREE.Mesh(visorGeometry, visorMaterial);
        visor.position.set(0.4, 0.3, 0);
        visor.rotation.y = Math.PI / 2;
        group.add(visor);

        // Backpack
        const backpackGeometry = new THREE.BoxGeometry(0.4, 0.6, 0.3);
        const backpack = new THREE.Mesh(backpackGeometry, bodyMaterial);
        backpack.position.set(-0.3, 0, 0);
        backpack.castShadow = true;
        group.add(backpack);

        // Name label
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;
        context.fillStyle = '#ffffff';
        context.font = 'bold 28px Arial';
        context.textAlign = 'center';
        context.fillText(data.username || 'Player', 128, 40);

        const texture = new THREE.CanvasTexture(canvas);
        const labelMaterial = new THREE.SpriteMaterial({ map: texture });
        const label = new THREE.Sprite(labelMaterial);
        label.position.set(0, 2, 0);
        label.scale.set(2, 0.5, 1);
        group.add(label);

        // Position
        const spawnPoint = CONFIG.MAP.SPAWN_POINTS[0];
        group.position.set(
            spawnPoint.x + (Math.random() - 0.5) * 5,
            1,
            spawnPoint.y + (Math.random() - 0.5) * 5
        );

        this.scene.add(group);

        this.players.set(playerId, {
            mesh: group,
            data: data,
            position: group.position.clone(),
            rotation: 0,
            isDead: false
        });

        return group;
    }

    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            this.scene.remove(player.mesh);
            this.players.delete(playerId);
        }
    }

    updatePlayerPosition(playerId, position, rotation) {
        const player = this.players.get(playerId);
        if (player && !player.isDead) {
            player.mesh.position.set(position.x, 1, position.z);
            player.mesh.rotation.y = rotation;
            player.position = position;
            player.rotation = rotation;
        }
    }

    killPlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            player.isDead = true;

            // Create dead body
            const bodyMesh = player.mesh.clone();
            bodyMesh.rotation.z = Math.PI / 2; // Lay down
            this.scene.add(bodyMesh);

            this.deadBodies.set(playerId, {
                mesh: bodyMesh,
                position: player.position.clone()
            });

            // Hide player
            player.mesh.visible = false;
        }
    }

    setLocalPlayer(playerId) {
        this.localPlayer = playerId;
    }

    updateCamera() {
        if (this.localPlayer) {
            const player = this.players.get(this.localPlayer);
            if (player) {
                // Third-person camera
                const offset = new THREE.Vector3(0, 8, 8);
                const rotatedOffset = offset.applyAxisAngle(
                    new THREE.Vector3(0, 1, 0),
                    player.rotation
                );

                this.camera.position.set(
                    player.position.x + rotatedOffset.x,
                    player.position.y + rotatedOffset.y,
                    player.position.z + rotatedOffset.z
                );

                this.camera.lookAt(
                    player.position.x,
                    player.position.y + 1,
                    player.position.z
                );
            }
        }
    }

    completeTask(taskId) {
        const task = this.tasks.get(taskId);
        if (task) {
            task.completed = true;
            task.mesh.material.color.setHex(0x26de81);
            task.mesh.material.emissive.setHex(0x26de81);
        }
    }

    getNearbyTasks(position, distance) {
        const nearby = [];
        this.tasks.forEach((task, id) => {
            if (!task.completed) {
                const dist = Math.sqrt(
                    Math.pow(position.x - task.position.x, 2) +
                    Math.pow(position.z - task.position.z, 2)
                );
                if (dist <= distance) {
                    nearby.push({ id, task });
                }
            }
        });
        return nearby;
    }

    getNearbyPlayers(position, distance) {
        const nearby = [];
        this.players.forEach((player, id) => {
            if (id !== this.localPlayer && !player.isDead) {
                const dist = Math.sqrt(
                    Math.pow(position.x - player.position.x, 2) +
                    Math.pow(position.z - player.position.z, 2)
                );
                if (dist <= distance) {
                    nearby.push({ id, player });
                }
            }
        });
        return nearby;
    }

    getNearbyBodies(position, distance) {
        const nearby = [];
        this.deadBodies.forEach((body, id) => {
            const dist = Math.sqrt(
                Math.pow(position.x - body.position.x, 2) +
                Math.pow(position.z - body.position.z, 2)
            );
            if (dist <= distance) {
                nearby.push({ id, body });
            }
        });
        return nearby;
    }

    render() {
        this.updateCamera();
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    clear() {
        // Remove all players
        this.players.forEach((player, id) => {
            this.scene.remove(player.mesh);
        });
        this.players.clear();

        // Remove all dead bodies
        this.deadBodies.forEach((body, id) => {
            this.scene.remove(body.mesh);
        });
        this.deadBodies.clear();

        // Reset tasks
        this.tasks.forEach((task, id) => {
            task.completed = false;
            task.mesh.material.color.setHex(0xfed330);
            task.mesh.material.emissive.setHex(0xfed330);
        });

        this.localPlayer = null;
    }
}

// Export
window.Game3D = Game3D;
