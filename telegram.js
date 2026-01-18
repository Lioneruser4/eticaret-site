// Telegram WebApp Integration
class TelegramAuth {
    constructor() {
        this.tg = window.Telegram?.WebApp;
        this.user = null;
        this.isGuest = true;

        this.init();
    }

    init() {
        if (this.tg) {
            // Telegram WebApp başlatma
            this.tg.ready();
            this.tg.expand();

            // Telegram kullanıcı bilgilerini al
            const initData = this.tg.initDataUnsafe;

            if (initData && initData.user) {
                this.user = {
                    id: initData.user.id,
                    firstName: initData.user.first_name || '',
                    lastName: initData.user.last_name || '',
                    username: initData.user.username || '',
                    photoUrl: initData.user.photo_url || this.getDefaultAvatar(),
                    languageCode: initData.user.language_code || 'tr'
                };
                this.isGuest = false;

                console.log('Telegram user authenticated:', this.user);
            } else {
                // Guest kullanıcı
                this.createGuestUser();
            }

            // Tema ayarları
            this.applyTheme();

            // Back button handler
            this.tg.BackButton.onClick(() => {
                this.handleBackButton();
            });
        } else {
            // Telegram WebApp dışında açıldıysa guest olarak devam et
            console.log('Not running in Telegram WebApp, creating guest user');
            this.createGuestUser();
        }
    }

    createGuestUser() {
        const guestId = this.generateGuestId();
        this.user = {
            id: guestId,
            firstName: 'Guest',
            lastName: guestId.toString().slice(-4),
            username: `guest_${guestId.toString().slice(-4)}`,
            photoUrl: this.getDefaultAvatar(),
            languageCode: 'tr'
        };
        this.isGuest = true;

        // Guest ID'yi localStorage'a kaydet
        localStorage.setItem('guestId', guestId);

        console.log('Guest user created:', this.user);
    }

    generateGuestId() {
        // Eğer daha önce guest ID oluşturulmuşsa onu kullan
        const savedGuestId = localStorage.getItem('guestId');
        if (savedGuestId) {
            return parseInt(savedGuestId);
        }

        // Yeni guest ID oluştur (negatif sayı ile Telegram ID'lerden ayırt et)
        return -Math.floor(Math.random() * 1000000000);
    }

    getDefaultAvatar() {
        // Default avatar URL
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(this.user?.firstName || 'Guest')}&background=ff4757&color=fff&size=200`;
    }

    applyTheme() {
        if (!this.tg) return;

        const themeParams = this.tg.themeParams;

        if (themeParams.bg_color) {
            document.documentElement.style.setProperty('--tg-bg-color', themeParams.bg_color);
        }
        if (themeParams.text_color) {
            document.documentElement.style.setProperty('--tg-text-color', themeParams.text_color);
        }
        if (themeParams.button_color) {
            document.documentElement.style.setProperty('--tg-button-color', themeParams.button_color);
        }
    }

    handleBackButton() {
        // Back button davranışı - ekrana göre değişir
        const currentScreen = document.querySelector('.screen:not(.hidden)');

        if (currentScreen) {
            const screenId = currentScreen.id;

            switch (screenId) {
                case 'main-menu':
                    // Ana menüdeyse uygulamayı kapat
                    if (this.tg) {
                        this.tg.close();
                    }
                    break;

                case 'create-room-screen':
                case 'join-room-screen':
                    // Oda oluşturma/katılma ekranındaysa ana menüye dön
                    window.uiManager?.showScreen('main-menu');
                    break;

                case 'room-lobby-screen':
                    // Lobideyse odadan ayrıl
                    window.networkManager?.leaveRoom();
                    window.uiManager?.showScreen('main-menu');
                    break;

                case 'game-screen':
                    // Oyun ekranındaysa uyarı göster
                    if (confirm('Oyundan ayrılmak istediğinize emin misiniz?')) {
                        window.networkManager?.leaveGame();
                        window.uiManager?.showScreen('main-menu');
                    }
                    break;

                default:
                    window.uiManager?.showScreen('main-menu');
            }
        }
    }

    showBackButton() {
        if (this.tg) {
            this.tg.BackButton.show();
        }
    }

    hideBackButton() {
        if (this.tg) {
            this.tg.BackButton.hide();
        }
    }

    showMainButton(text, onClick) {
        if (this.tg) {
            this.tg.MainButton.setText(text);
            this.tg.MainButton.onClick(onClick);
            this.tg.MainButton.show();
        }
    }

    hideMainButton() {
        if (this.tg) {
            this.tg.MainButton.hide();
        }
    }

    vibrate(style = 'medium') {
        if (this.tg && this.tg.HapticFeedback) {
            this.tg.HapticFeedback.impactOccurred(style);
        }
    }

    showAlert(message) {
        if (this.tg) {
            this.tg.showAlert(message);
        } else {
            alert(message);
        }
    }

    showConfirm(message, callback) {
        if (this.tg) {
            this.tg.showConfirm(message, callback);
        } else {
            const result = confirm(message);
            callback(result);
        }
    }

    getUser() {
        return this.user;
    }

    getUserId() {
        return this.user?.id || 0;
    }

    getUserName() {
        const user = this.user;
        if (!user) return 'Guest';

        if (user.firstName && user.lastName) {
            return `${user.firstName} ${user.lastName}`;
        } else if (user.firstName) {
            return user.firstName;
        } else if (user.username) {
            return user.username;
        } else {
            return 'Guest';
        }
    }

    getUserAvatar() {
        return this.user?.photoUrl || this.getDefaultAvatar();
    }

    isGuestUser() {
        return this.isGuest;
    }
}

// Global instance
window.telegramAuth = new TelegramAuth();
