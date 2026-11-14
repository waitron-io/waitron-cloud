ALTER TABLE guest_menus DROP CONSTRAINT guest_menus_default_language_check;
ALTER TABLE guest_menus ADD CONSTRAINT guest_menus_default_language_check
 CHECK (default_language = 'ca-ES-valencia' OR default_language ~ '^[a-z]{2,3}$');
