# Трекер активності людини на STM32U585 (B-U585I-IOT02A)

Носимий прототип класифікації фізичної активності (5 класів HAR: **Lying, Stationary, Walking, Running, Stairs**) на базі плати **B-U585I-IOT02A** (`STM32U585AII6Q` + IMU `ISM330DHCX` + BLE `STM32WB5MMG`), ML-моделей **ST-IGN** та вебінтерфейсу прийому телеметрії (**Web Bluetooth / USB Serial**).

---

## 1. Структура папок проєкту

```text
├── ble_firmware/                     # Код BLE для прошивки STM32U585 (STM32CubeIDE)
│   ├── ble_tracker.h                 # Заголовок драйвера BLE та 8-байтний BleActivityPacket_t
│   ├── ble_tracker.c                 # Робота з STM32WB5MMG по UART4 (AT-сервер / міст)
│   ├── main_ble_snippet.c            # Фрагменти для вставки у USER CODE BEGIN в main.c
│   └── README.md                     # Інструкція додавання в STM32CubeIDE
├── src/                              # Код модульного вебсайту (React + TypeScript + Tailwind)
│   ├── App.tsx                       # Головний інтерфейс, Web Bluetooth (GATT) і Web Serial (USB)
│   ├── components/
│   │   ├── ImuWaveformChart.tsx      # Графік 6 осей IMU у реальному часі
│   │   └── ActivityTimeline.tsx      # Аналітика: розподіл по 5 класах та стрічка сесії
│   ├── types/
│   │   ├── telemetry.ts              # 5 класів HAR, GATT UUID та типи пакетів
│   │   └── webapis.d.ts              # Типи браузерних API (Web Bluetooth, Web Serial)
│   ├── utils/
│   │   └── protocol.ts               # Декодер 8-байтних BLE-пакетів, #act і USB CSV + експорт
│   ├── index.css                     # Підключення Tailwind CSS і шрифтів
│   └── main.tsx                      # Точка входу React
├── .github/workflows/
│   └── deploy-pages.yml              # Автозбірка та публікація сайту на GitHub Pages
├── index.html                        # HTML-шаблон вебсайту
├── vite.config.ts                    # Конфігурація збірки Vite (base: './' для GitHub Pages)
├── package.json                      # Залежності та скрипти (dev / build / lint)
└── tsconfig.json                     # Налаштування TypeScript
```

---

## 2. Як і що запускати

### А. Публікація нормального сайту на GitHub Pages (безкоштовно, один раз)
1. Створіть репозиторій на GitHub (наприклад, `u585-activity-tracker`) і завантажте туди цей проєкт (включно з прихованою папкою `.github/workflows/deploy-pages.yml`).
2. У репозиторії відкрийте **Settings → Pages**.
3. У полі **Build and deployment → Source** виберіть **GitHub Actions**.
4. Через 1–2 хвилини GitHub сам збере проєкт і видасть постійне HTTPS-посилання:
   `https://<ваш-логін>.github.io/<назва-репозиторію>/`
5. Надалі просто відкривайте це посилання у **Chrome** або **Edge** (на ПК чи Android) і тисніть **«Підключити BLE»**.

### Б. Збір та перегляд даних із плати (BLE або USB)
1. **Через BLE:** увімкніть живлення плати **B-U585I-IOT02A** (з прошитим `ble_firmware/`) і натисніть **«Підключити BLE»** на сайті.
2. **Через USB:** підключіть плату кабелем USB до **ST-LINK** та натисніть **«USB Serial (USART1)»** (115200 бод).

### В. Локальний запуск сайту для розробки
```bash
npm install
npm run dev
# Відкрити http://localhost:3000 у Chrome або Edge
```

---

## 3. Як вставити та перевірити BLE-код у STM32CubeIDE

На платі **B-U585I-IOT02A** бездротовий модуль **STM32WB5MMG** уже підключений до мікроконтролера **STM32U585** через:
- `UART4`: **PC10** (`WRLS_UART4_TX`), **PC11** (`WRLS_UART4_RX`), швидкість `115200 8N1`
- `PG6`: **WRLS_WKUP_B** (пробудження BLE-модуля)
- `PD14 / PG15`: **WRLS_NOTIFY / WRLS_FLOW**

### Крок 1. Налаштування `.ioc` у STM32CubeIDE
1. Відкрийте `firmware/activity_tracker_fw/activity_tracker_fw.ioc`.
2. Перейдіть у **Connectivity → UART4 → NVIC Settings**.
3. Поставте галочку **UART4 global interrupt** (щоб працював асинхронний прийом подій через `HAL_UART_Receive_IT`).
4. Натисніть **Ctrl+S** і дозвольте генерацію коду.

### Крок 2. Додавання файлів BLE-драйвера
1. Скопіюйте файл **`ble_tracker.h`** у папку `firmware/activity_tracker_fw/Core/Inc/`.
2. Скопіюйте файл **`ble_tracker.c`** у папку `firmware/activity_tracker_fw/Core/Src/`.
3. За замовчуванням у `ble_tracker.h` увімкнено режим **передачі лише підсумку класифікації** (`#define BLE_SEND_RAW_IMU 0`) — це мінімізує витрати батареї.

### Крок 3. Інтеграція в `Core/Src/main.c`
У вашому `main.c` оновіть лише блоки `/* USER CODE BEGIN ... */`, щоб CubeMX не затер зміни:
1. **Includes**: підключіть `<math.h>` та `"ble_tracker.h"`.
2. **PV**: додайте кільцевий буфер `har_ring[55][6]` та функцію інференції `Run_Local_HAR_Inference()`.
3. **USER CODE BEGIN 2**: після `imu_init();` викличте `BLE_Tracker_Init(&huart4);`.
4. **USER CODE BEGIN 3 (всередині `if (drdy_now != imu_drdy_served)`)**: записуйте `ax_g..gz_dps` у `har_ring`, а кожні **27 семплів** викликайте `BLE_Tracker_SendActivity(&act_pkt);` та `BLE_Tracker_ProcessRx();`.

### Крок 4. Перевірка після прошивки
1. Зберіть проєкт (**Project → Build Project**) та прошийте плату (**Run → Run**).
2. Підключіться до плати через **USB Serial (USART1)** на сайті (або в терміналі 115200 бод) та натисніть **Reset** на платі:
   - **Сценарій А (успіх):** у лозі є `[BLE] RX: OK` та `[BLE] READY & Advertising as U585_HAR (ADV=1)`. Тепер тисніть **«Підключити BLE»** на сайті або знайдіть пристрій **U585_HAR** у мобільному додатку **nRF Connect / ST BLE Sensor**.
   - **Сценарій Б (модуль мовчить):** у лозі з’явиться `[BLE] NO RESPONSE from STM32WB5MMG`. Це означає, що на самому співпроцесорі `STM32WB5MMG` не прошито `BLE_AT_Server`. Прошийте на `STM32WB5MMG` файл `BLE_AT_Server_reference.hex` із пакета **STM32CubeWB** через **STM32CubeProgrammer** (і оновіть FUS / BLE Stack за інструкцією ST для B-U585I-IOT02A).
   - **Налагодження без BLE:** незалежно від відповіді модуля, у USB `USART1` кожні 27 семплів друкуватиметься `#act,<timestamp_ms>,<id>,<conf>,<missed_samples>`, тож сайт одразу покаже поточний клас активності в реальному часі.
