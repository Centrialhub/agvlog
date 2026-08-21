-- Drop existing functions to allow changes in signatures/defaults
DROP FUNCTION IF EXISTS public.create_employee_v1(uuid, jsonb);
DROP FUNCTION IF EXISTS public.update_employee_v1(uuid, uuid, jsonb, integer);
DROP FUNCTION IF EXISTS public.delete_employee_v1(uuid, uuid);

CREATE OR REPLACE FUNCTION public.create_employee_v1(
    p_tenant_id uuid,
    p_values jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_employee_id uuid;
    v_manager_id uuid;
BEGIN
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    v_manager_id := (p_values->>'manager_id')::uuid;
    IF v_manager_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = v_manager_id AND tenant_id = p_tenant_id) THEN
            RAISE EXCEPTION 'Gestor não pertence ao mesmo tenant';
        END IF;
    END IF;

    INSERT INTO public.employees (
        tenant_id,
        name,
        doc_cpf,
        doc_rg,
        role_title,
        department,
        branch,
        manager_id,
        cost_center,
        hire_date,
        termination_date,
        status,
        phone,
        email,
        cnh_number,
        cnh_category,
        cnh_expiry,
        medical_exam_expiry,
        driver_id,
        user_id,
        notes,
        version
    ) VALUES (
        p_tenant_id,
        p_values->>'name',
        p_values->>'doc_cpf',
        p_values->>'doc_rg',
        p_values->>'role_title',
        p_values->>'department',
        p_values->>'branch',
        v_manager_id,
        p_values->>'cost_center',
        (p_values->>'hire_date')::date,
        (p_values->>'termination_date')::date,
        COALESCE(p_values->>'status', 'active')::text,
        p_values->>'phone',
        p_values->>'email',
        p_values->>'cnh_number',
        p_values->>'cnh_category',
        (p_values->>'cnh_expiry')::date,
        (p_values->>'medical_exam_expiry')::date,
        (p_values->>'driver_id')::uuid,
        (p_values->>'user_id')::uuid,
        p_values->>'notes',
        1
    ) RETURNING id INTO v_employee_id;

    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, to_status, metadata
    ) VALUES (
        p_tenant_id, 'employee', v_employee_id, COALESCE(p_values->>'status', 'active'), 
        jsonb_build_object('action', 'create')
    );

    RETURN v_employee_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_employee_v1(
    p_tenant_id uuid,
    p_employee_id uuid,
    p_values jsonb,
    p_expected_version integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows_affected integer;
    v_manager_id uuid;
BEGIN
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    IF p_values ? 'manager_id' THEN
        v_manager_id := (p_values->>'manager_id')::uuid;
        IF v_manager_id IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = v_manager_id AND tenant_id = p_tenant_id) THEN
                RAISE EXCEPTION 'Gestor não pertence ao mesmo tenant';
            END IF;
        END IF;
    END IF;

    UPDATE public.employees
    SET
        name = COALESCE(p_values->>'name', name),
        doc_cpf = COALESCE(p_values->>'doc_cpf', doc_cpf),
        doc_rg = COALESCE(p_values->>'doc_rg', doc_rg),
        role_title = COALESCE(p_values->>'role_title', role_title),
        department = COALESCE(p_values->>'department', department),
        branch = COALESCE(p_values->>'branch', branch),
        manager_id = CASE WHEN p_values ? 'manager_id' THEN v_manager_id ELSE manager_id END,
        cost_center = COALESCE(p_values->>'cost_center', cost_center),
        hire_date = COALESCE((p_values->>'hire_date')::date, hire_date),
        termination_date = COALESCE((p_values->>'termination_date')::date, termination_date),
        status = COALESCE(p_values->>'status', status),
        phone = COALESCE(p_values->>'phone', phone),
        email = COALESCE(p_values->>'email', email),
        cnh_number = COALESCE(p_values->>'cnh_number', cnh_number),
        cnh_category = COALESCE(p_values->>'cnh_category', cnh_category),
        cnh_expiry = COALESCE((p_values->>'cnh_expiry')::date, cnh_expiry),
        medical_exam_expiry = COALESCE((p_values->>'medical_exam_expiry')::date, medical_exam_expiry),
        driver_id = COALESCE((p_values->>'driver_id')::uuid, driver_id),
        user_id = COALESCE((p_values->>'user_id')::uuid, user_id),
        notes = COALESCE(p_values->>'notes', notes),
        version = version + 1,
        updated_at = now()
    WHERE id = p_employee_id 
      AND tenant_id = p_tenant_id 
      AND version = p_expected_version;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected = 0 THEN
        IF EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id AND tenant_id = p_tenant_id) THEN
            RAISE EXCEPTION 'Conflito de versão (bloqueio otimista)';
        ELSE
            RAISE EXCEPTION 'Funcionário não encontrado ou não pertence ao tenant';
        END IF;
    END IF;

    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, to_status, metadata
    ) VALUES (
        p_tenant_id, 'employee', p_employee_id, COALESCE(p_values->>'status', 'updated'), 
        jsonb_build_object('action', 'update', 'version', p_expected_version + 1)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_employee_v1(
    p_tenant_id uuid,
    p_employee_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_exists boolean;
BEGIN
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id AND tenant_id = p_tenant_id)
    INTO v_exists;

    IF NOT v_exists THEN
        RAISE EXCEPTION 'Funcionário não encontrado ou não pertence ao tenant';
    END IF;

    DELETE FROM public.employees WHERE id = p_employee_id AND tenant_id = p_tenant_id;

    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, to_status, metadata
    ) VALUES (
        p_tenant_id, 'employee', p_employee_id, 'deleted', 
        jsonb_build_object('action', 'delete')
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_employee_v1(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_v1(uuid, uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_employee_v1(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_employee_v1(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_employee_v1(uuid, uuid, jsonb, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_employee_v1(uuid, uuid) FROM PUBLIC;

REVOKE INSERT, UPDATE, DELETE ON public.employees FROM authenticated;
GRANT SELECT ON public.employees TO authenticated;