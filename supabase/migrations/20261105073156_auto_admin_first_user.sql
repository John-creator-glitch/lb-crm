/*
# Auto-admin for first user + promote existing user

## Changes
1. Update the `handle_new_user` trigger function so that the very first user
   to register (when auth.users has only 1 row) is automatically assigned the
   'admin' role instead of 'staff'. Subsequent users remain 'staff'.
2. Promote the existing single user (John) to admin since they were the first
   to register but received 'staff' under the old trigger.

## Security
- No new tables or policies.
- Only affects the profiles table role column.
*/

-- Promote the existing first user to admin
UPDATE profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);

-- Update the trigger function: first user becomes admin automatically
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_count integer;
BEGIN
  SELECT COUNT(*) INTO user_count FROM auth.users;
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    CASE WHEN user_count = 1 THEN 'admin' ELSE 'staff' END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
