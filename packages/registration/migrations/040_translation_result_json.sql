-- JSON retains escaped NUL and lone UTF-16 surrogates accepted by the wire contract.
ALTER TABLE translation_job_bodies DROP CONSTRAINT translation_job_bodies_batch_results_check;
ALTER TABLE translation_job_bodies ALTER COLUMN batch_results DROP DEFAULT;
ALTER TABLE translation_job_bodies ALTER COLUMN batch_results TYPE json USING batch_results::json;
ALTER TABLE translation_job_bodies ALTER COLUMN batch_results SET DEFAULT '{}'::json;
ALTER TABLE translation_job_bodies ADD CONSTRAINT translation_job_bodies_batch_results_check CHECK (json_typeof(batch_results)='object');
