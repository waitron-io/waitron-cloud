// Reporter authority and cursors remain durable; the latest private cause never enters a logical backup.
export const privateObservationDumpArgs=Object.freeze(['--exclude-table-data=*.remote_forward_observations']);
