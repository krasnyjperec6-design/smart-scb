-- Посмотреть все параметры устройств
SELECT *
FROM devices
ORDER BY id;

-- Пример: увеличить время перевода, ток и температуру SW-17
UPDATE devices
SET switch_time = 7.2,
    current = 5.8,
    temperature = 56,
    cycles = cycles + 1000
WHERE id = 'SW-17';

-- Пример: потеря контроля положения SW-17
UPDATE devices
SET control = 0,
    forced_bad = 1,
    failures = failures + 1
WHERE id = 'SW-17';

-- Пример: занять рельсовую цепь TC-03
UPDATE devices
SET occupied = 1
WHERE id = 'TC-03';

-- После выполнения UPDATE нажмите в интерфейсе «Обновить из БД».
