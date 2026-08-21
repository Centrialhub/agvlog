-- Semântica de atualização de funcionários v1
-- Implementa precisão JSONB (? 'key'), bloqueio otimista obrigatório e auditoria atômica.

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
    v_old_data jsonb;
    v_new_data jsonb;
    v_operator_id uuid;
    v_allowed_keys text[] := ARRAY[
        'name', 'doc_cpf', 'doc_rg', 'role_title', 'department', 
        'branch', 'manager_id', 'cost_center', 'hire_date', 
        'termination_date', 'status', 'phone', 'email', 
        'cnh_number', 'cnh_category', 'cnh_expiry', 
        'medical_exam_expiry', 'driver_id', 'user_id', 'notes'
    ];
    v_key text;
    v_manager_tenant_id uuid;
    v_driver_tenant_id uuid;
BEGIN
    -- 1. Autorização
    v_operator_id := auth.uid();
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = v_operator_id 
          AND (role = 'admin' OR role = 'moderator')
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Operator permissions required' USING ERRCODE = '42501';
    END IF;

    -- 2. Lock e Bloqueio Otimista (Obrigatório)
    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'p_expected_version is required for optimistic locking' USING ERRCODE = 'P0004';
    END IF;

    SELECT to_jsonb(e.*) INTO v_old_data
    FROM public.employees e
    WHERE e.id = p_employee_id 
      AND e.tenant_id = p_tenant_id
    FOR UPDATE;

    IF v_old_data IS NULL THEN
        RAISE EXCEPTION 'Employee not found or access denied' USING ERRCODE = 'P0002';
    END IF;

    IF (v_old_data->>'version')::int != p_expected_version THEN
        RAISE EXCEPTION 'Conflict: Employee was modified by another user (expected version %, found %)', 
            p_expected_version, (v_old_data->>'version')::int
            USING ERRCODE = 'P0001';
    END IF;

    -- 3. Validação de Chaves
    FOR v_key IN SELECT jsonb_object_keys(p_values) LOOP
        IF NOT v_key = ANY(v_allowed_keys) THEN
            RAISE EXCEPTION 'Invalid field: %', v_key USING ERRCODE = '42703';
        END IF;
    END LOOP;

    -- 4. Validação Cross-Tenant
    IF p_values ? 'manager_id' AND (p_values->>'manager_id') IS NOT NULL THEN
        SELECT tenant_id INTO v_manager_tenant_id FROM public.employees WHERE id = (p_values->>'manager_id')::uuid;
        IF v_manager_tenant_id IS DISTINCT FROM p_tenant_id THEN
            RAISE EXCEPTION 'Cross-tenant violation: Manager belongs to another tenant' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF p_values ? 'driver_id' AND (p_values->>'driver_id') IS NOT NULL THEN
        SELECT tenant_id INTO v_driver_tenant_id FROM public.drivers WHERE id = (p_values->>'driver_id')::uuid;
        IF v_driver_tenant_id IS DISTINCT FROM p_tenant_id THEN
            RAISE EXCEPTION 'Cross-tenant violation: Driver belongs to another tenant' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 5. Update Dinâmico
    UPDATE public.employees
    SET
        name = CASE WHEN p_values ? 'name' THEN (p_values->>'name') ELSE name END,
        doc_cpf = CASE WHEN p_values ? 'doc_cpf' THEN (p_values->>'doc_cpf') ELSE doc_cpf END,
        doc_rg = CASE WHEN p_values ? 'doc_rg' THEN (p_values->>'doc_rg') ELSE doc_rg END,
        role_title = CASE WHEN p_values ? 'role_title' THEN (p_values->>'role_title') ELSE role_title END,
        department = CASE WHEN p_values ? 'department' THEN (p_values->>'department') ELSE department END,
        branch = CASE WHEN p_values ? 'branch' THEN (p_values->>'branch') ELSE branch END,
        manager_id = CASE WHEN p_values ? 'manager_id' THEN (p_values->>'manager_id')::uuid ELSE manager_id END,
        cost_center = CASE WHEN p_values ? 'cost_center' THEN (p_values->>'cost_center') ELSE cost_center END,
        hire_date = CASE WHEN p_values ? 'hire_date' THEN (p_values->>'hire_date')::date ELSE hire_date END,
        termination_date = CASE WHEN p_values ? 'termination_date' THEN (p_values->>'termination_date')::date ELSE termination_date END,
        status = CASE WHEN p_values ? 'status' THEN (p_values->>'status')::app_employee_status ELSE status END,
        phone = CASE WHEN p_values ? 'phone' THEN (p_values->>'phone') ELSE phone END,
        email = CASE WHEN p_values ? 'email' THEN (p_values->>'email') ELSE email END,
        cnh_number = CASE WHEN p_values ? 'cnh_number' THEN (p_values->>'cnh_number') ELSE cnh_number END,
        cnh_category = CASE WHEN p_values ? 'cnh_category' THEN (p_values->>'cnh_category') ELSE cnh_category END,
        cnh_expiry = CASE WHEN p_values ? 'cnh_expiry' THEN (p_values->>'cnh_expiry')::date ELSE cnh_expiry END,
        medical_exam_expiry = CASE WHEN p_values ? 'medical_exam_expiry' THEN (p_values->>'medical_exam_expiry')::date ELSE medical_exam_expiry END,
        driver_id = CASE WHEN p_values ? 'driver_id' THEN (p_values->>'driver_id')::uuid ELSE driver_id END,
        user_id = CASE WHEN p_values ? 'user_id' THEN (p_values->>'user_id')::uuid ELSE user_id END,
        notes = CASE WHEN p_values ? 'notes' THEN (p_values->>'notes') ELSE notes END,
        version = version + 1,
        updated_at = now()
    WHERE id = p_employee_id AND tenant_id = p_tenant_id;

    -- 6. Auditoria ( vehicle_events como ledger de auditoria )
    SELECT to_jsonb(e.*) INTO v_new_data FROM public.employees e WHERE e.id = p_employee_id;
    
    INSERT INTO public.vehicle_events (
        tenant_id,
        event_type,
        payload,
        created_by
    ) VALUES (
        p_tenant_id,
        'employee_updated',
        jsonb_build_object(
            'employee_id', p_employee_id,
            'before', v_old_data,
            'after', v_new_data,
            'changed_fields', p_values
        ),
        v_operator_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_employee_v1(uuid, uuid, jsonb, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.update_employee_v1(uuid, uuid, jsonb, integer) FROM PUBLIC, anon;
