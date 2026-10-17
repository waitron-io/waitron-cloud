INSERT INTO installation_services(installation_id,service,state)
 SELECT id,'content_translation','ready' FROM installations
 ON CONFLICT (installation_id,service) DO NOTHING;
