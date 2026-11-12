-- Карта ЛПУ 2.0: керування клініками, заявки на видалення та коригування спеціальностей
-- Виконувати в Supabase SQL Editor один раз. Початковий data.json не змінюється.

CREATE OR REPLACE FUNCTION public.is_lpu_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lpu_user_profiles
    WHERE user_id = auth.uid() AND is_admin = TRUE
  );
$$;

CREATE TABLE IF NOT EXISTS public.lpu_clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic text NOT NULL,
  locations jsonb NOT NULL DEFAULT '[]'::jsonb,
  specialties text[] NOT NULL DEFAULT '{}',
  added_by_surname text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clinic_visibility (
  clinic_name text PRIMARY KEY,
  is_hidden boolean NOT NULL DEFAULT true,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clinic_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_name text NOT NULL,
  requested_by_surname text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text,
  reviewed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.specialty_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_name text NOT NULL,
  original_specialty text NOT NULL,
  corrected_specialty text NOT NULL,
  submitted_by_surname text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text,
  reviewed_at timestamptz
);

ALTER TABLE public.lpu_clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialty_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read clinics" ON public.lpu_clinics;
CREATE POLICY "Authenticated read clinics" ON public.lpu_clinics
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage clinics" ON public.lpu_clinics;
CREATE POLICY "Admins manage clinics" ON public.lpu_clinics
  FOR ALL TO authenticated USING (public.is_lpu_admin()) WITH CHECK (public.is_lpu_admin());

DROP POLICY IF EXISTS "Authenticated read clinic visibility" ON public.clinic_visibility;
CREATE POLICY "Authenticated read clinic visibility" ON public.clinic_visibility
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage clinic visibility" ON public.clinic_visibility;
CREATE POLICY "Admins manage clinic visibility" ON public.clinic_visibility
  FOR ALL TO authenticated USING (public.is_lpu_admin()) WITH CHECK (public.is_lpu_admin());

DROP POLICY IF EXISTS "Users create own deletion requests" ON public.clinic_deletion_requests;
CREATE POLICY "Users create own deletion requests" ON public.clinic_deletion_requests
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND status = 'pending' AND EXISTS (
      SELECT 1 FROM public.lpu_user_profiles p
      WHERE p.user_id = auth.uid() AND p.surname = requested_by_surname
    )
  );
DROP POLICY IF EXISTS "Users read own or admin reads all deletion requests" ON public.clinic_deletion_requests;
CREATE POLICY "Users read own or admin reads all deletion requests" ON public.clinic_deletion_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_lpu_admin());
DROP POLICY IF EXISTS "Admins review deletion requests" ON public.clinic_deletion_requests;
CREATE POLICY "Admins review deletion requests" ON public.clinic_deletion_requests
  FOR UPDATE TO authenticated USING (public.is_lpu_admin()) WITH CHECK (public.is_lpu_admin());

DROP POLICY IF EXISTS "Users create own specialty corrections" ON public.specialty_corrections;
CREATE POLICY "Users create own specialty corrections" ON public.specialty_corrections
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND status = 'pending' AND EXISTS (
      SELECT 1 FROM public.lpu_user_profiles p
      WHERE p.user_id = auth.uid() AND p.surname = submitted_by_surname
    )
  );
DROP POLICY IF EXISTS "Users read approved or own pending corrections" ON public.specialty_corrections;
CREATE POLICY "Users read approved or own pending corrections" ON public.specialty_corrections
  FOR SELECT TO authenticated USING (status = 'approved' OR user_id = auth.uid() OR public.is_lpu_admin());
DROP POLICY IF EXISTS "Admins review specialty corrections" ON public.specialty_corrections;
CREATE POLICY "Admins review specialty corrections" ON public.specialty_corrections
  FOR UPDATE TO authenticated USING (public.is_lpu_admin()) WITH CHECK (public.is_lpu_admin());

GRANT EXECUTE ON FUNCTION public.is_lpu_admin() TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lpu_clinics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinic_visibility TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.clinic_deletion_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.specialty_corrections TO authenticated;


-- Журнал аудиту. Доступ на читання має лише адміністратор.
CREATE TABLE IF NOT EXISTS public.lpu_change_archive (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  entity_table text NOT NULL,
  entity_id text,
  action text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  actor_user_id uuid,
  actor_surname text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lpu_change_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Only admins read change archive" ON public.lpu_change_archive;
CREATE POLICY "Only admins read change archive" ON public.lpu_change_archive
  FOR SELECT TO authenticated USING (public.is_lpu_admin());
GRANT SELECT ON public.lpu_change_archive TO authenticated;

-- Trigger function captures row snapshots and the authenticated actor.
CREATE OR REPLACE FUNCTION public.log_lpu_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_id text;
  v_actor text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_row := v_new;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_row := v_new;
  ELSE
    v_old := to_jsonb(OLD);
    v_row := v_old;
  END IF;

  v_id := COALESCE(v_row->>'id', v_row->>'clinic_name', v_row->>'clinic', v_row->>'specialty');
  SELECT surname INTO v_actor
  FROM public.lpu_user_profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  INSERT INTO public.lpu_change_archive(
    entity_table, entity_id, action, actor_user_id, actor_surname, old_data, new_data
  ) VALUES (
    TG_TABLE_NAME, v_id, TG_OP, auth.uid(), COALESCE(v_actor,'Системна операція'), v_old, v_new
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_lpu_clinics ON public.lpu_clinics;
CREATE TRIGGER audit_lpu_clinics AFTER INSERT OR UPDATE OR DELETE ON public.lpu_clinics
  FOR EACH ROW EXECUTE FUNCTION public.log_lpu_change();

DROP TRIGGER IF EXISTS audit_clinic_extra_specialties ON public.clinic_extra_specialties;
CREATE TRIGGER audit_clinic_extra_specialties AFTER INSERT OR UPDATE OR DELETE ON public.clinic_extra_specialties
  FOR EACH ROW EXECUTE FUNCTION public.log_lpu_change();

DROP TRIGGER IF EXISTS audit_clinic_visibility ON public.clinic_visibility;
CREATE TRIGGER audit_clinic_visibility AFTER INSERT OR UPDATE OR DELETE ON public.clinic_visibility
  FOR EACH ROW EXECUTE FUNCTION public.log_lpu_change();

DROP TRIGGER IF EXISTS audit_specialty_corrections ON public.specialty_corrections;
CREATE TRIGGER audit_specialty_corrections AFTER INSERT OR UPDATE OR DELETE ON public.specialty_corrections
  FOR EACH ROW EXECUTE FUNCTION public.log_lpu_change();

DROP TRIGGER IF EXISTS audit_clinic_deletion_requests ON public.clinic_deletion_requests;
CREATE TRIGGER audit_clinic_deletion_requests AFTER INSERT OR UPDATE OR DELETE ON public.clinic_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_lpu_change();
