CREATE TABLE IF NOT EXISTS cities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  province VARCHAR(120) NULL,
  country VARCHAR(120) NOT NULL DEFAULT 'Canada',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cities_name_province_country (name, province, country),
  KEY idx_cities_active_name (is_active, name)
);

CREATE TABLE IF NOT EXISTS city_points (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  city_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  address VARCHAR(255) NOT NULL,
  lat DECIMAL(10, 7) NOT NULL,
  lng DECIMAL(10, 7) NOT NULL,
  point_type ENUM('station', 'airport', 'university', 'mall', 'downtown', 'custom') NOT NULL DEFAULT 'custom',
  popularity_score INT NOT NULL DEFAULT 0,
  usage_count INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_city_points_city (city_id),
  KEY idx_city_points_lookup (city_id, is_active, popularity_score),
  KEY idx_city_points_type (point_type),
  CONSTRAINT fk_city_points_city FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE CASCADE ON UPDATE RESTRICT
);

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS departure_city_id BIGINT UNSIGNED NULL AFTER to_address,
  ADD COLUMN IF NOT EXISTS arrival_city_id BIGINT UNSIGNED NULL AFTER departure_city_id,
  ADD COLUMN IF NOT EXISTS departure_point_id BIGINT UNSIGNED NULL AFTER arrival_city_id,
  ADD COLUMN IF NOT EXISTS arrival_point_id BIGINT UNSIGNED NULL AFTER departure_point_id,
  ADD COLUMN IF NOT EXISTS departure_address VARCHAR(255) NULL AFTER arrival_point_id,
  ADD COLUMN IF NOT EXISTS departure_lat DECIMAL(10, 7) NULL AFTER departure_address,
  ADD COLUMN IF NOT EXISTS departure_lng DECIMAL(10, 7) NULL AFTER departure_lat,
  ADD COLUMN IF NOT EXISTS arrival_address VARCHAR(255) NULL AFTER departure_lng,
  ADD COLUMN IF NOT EXISTS arrival_lat DECIMAL(10, 7) NULL AFTER arrival_address,
  ADD COLUMN IF NOT EXISTS arrival_lng DECIMAL(10, 7) NULL AFTER arrival_lat;

CREATE INDEX idx_trips_departure_city ON trips (departure_city_id);
CREATE INDEX idx_trips_arrival_city ON trips (arrival_city_id);
CREATE INDEX idx_trips_departure_point ON trips (departure_point_id);
CREATE INDEX idx_trips_arrival_point ON trips (arrival_point_id);

ALTER TABLE trips
  ADD CONSTRAINT fk_trips_departure_city FOREIGN KEY (departure_city_id) REFERENCES cities(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT fk_trips_arrival_city FOREIGN KEY (arrival_city_id) REFERENCES cities(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT fk_trips_departure_point FOREIGN KEY (departure_point_id) REFERENCES city_points(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT fk_trips_arrival_point FOREIGN KEY (arrival_point_id) REFERENCES city_points(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
