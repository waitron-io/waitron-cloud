ALTER TABLE relay_messages
 DROP CONSTRAINT relay_messages_class_check,
 ADD CONSTRAINT relay_messages_class_check CHECK (class IN (
  'invitation', 'password_reset', 'email_change',
  'email_changed', 'security_change', 'role_membership_changed'
 ));
