ALTER TABLE organisations
  ADD COLUMN service_plan text NOT NULL DEFAULT 'free' CHECK (service_plan IN ('free', 'paid')),
  ADD COLUMN service_plan_revision integer NOT NULL DEFAULT 0 CHECK (service_plan_revision >= 0);
