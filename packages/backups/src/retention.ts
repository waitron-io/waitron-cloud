/** Display and deletion use UTC calendar arithmetic, independent of connection time zones. */
export const retentionExpirySql = "(p.captured_at AT TIME ZONE 'UTC' + CASE p.retention WHEN 'daily' THEN interval '30 days' ELSE interval '12 months' END) AT TIME ZONE 'UTC'";
