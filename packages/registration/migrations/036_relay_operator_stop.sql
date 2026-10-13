CREATE TABLE relay_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  stopped boolean NOT NULL DEFAULT false
);
INSERT INTO relay_control(singleton, stopped) VALUES (true, false);
