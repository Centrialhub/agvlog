-- Employee CRUD RPCs v1
-- Enforce strict multi-tenant isolation and membership checks.

-- Add versioning to employees for optimistic locking
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'version') THEN
        ALTER TABLE public.employees ADD COLUMN version integer NOT NULL DEFAULT 1;
    END IF;
END $$;

-- 1. create_employee_v1
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
    v_user_id uuid := auth.uid();
BEGIN
    -- Auth Guard: Membership & Role
    PERFORM public.check_tenant_membership(p_tenant_id);
    
    IF NOT public.is_tenant_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado: Apenas administradores podem cadastrar funcionários.';
    END IF;

    -- Insert with explicit fields from JSONB for validation/safety
    INSERT INTO public.employees (
        tenant_id,
        name,
        doc_cpf,
        doc_rg,
        role_title,
        department,
        branch,
        cost_center,
        hire_date,
        status,
        phone,
        email,
        cnh_number,
        cnh_category,
        cnh_expiry,
        medical_exam_expiry,
        notes,
        created_by,
        version
    ) VALUES (
        p_tenant_id,
        (p_values->>'name')::text,
        (p_values->>'doc_cpf')::text,
        (p_values->>'doc_rg')::text,
        (p_values->>'role_title')::text,
        (p_values->>'department')::text,
        (p_values->>'branch')::text,
        (p_values->>'cost_center')::text,
        (p_values->>'hire_date')::date,
        COALESCE((p_values->>'status')::text, 'active'),
        (p_values->>'phone')::text,
        (p_values->>'email')::text,
        (p_values->>'cnh_number')::text,
        (p_values->>'cnh_category')::text,
        (p_values->>'cnh_expiry')::date,
        (p_values->>'medical_exam_expiry')::date,
        (p_values->>'notes')::text,
        v_user_id,
        1
    ) RETURNING id INTO v_employee_id;

    -- Audit trail
    PERFORM public._log_entity_audit(
        p_tenant_id, 
        'employee', 
        v_employee_id, 
        'create', 
        NULL, 
        p_values, 
        'hr_rpc'
    );

    RETURN v_employee_id;
END;
$$;

-- 2. update_employee_v1
CREATE OR REPLACE FUNCTION public.update_employee_v1(
    p_tenant_id uuid,
    p_employee_id uuid,
    p_values jsonb,
    p_expected_version int DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_data jsonb;
    v_user_id uuid := auth.uid();
    v_current_version int;
BEGIN
    -- Auth Guard
    PERFORM public.check_tenant_membership(p_tenant_id);
    
    IF NOT (public.is_tenant_admin(p_tenant_id) OR public.is_tenant_operator_or_admin(p_tenant_id)) THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    -- Optimistic Locking & Existence Check
    SELECT version, to_jsonb(e.*) INTO v_current_version, v_old_data 
    FROM public.employees e 
    WHERE id = p_employee_id AND tenant_id = p_tenant_id;

    IF v_old_data IS NULL THEN
        RAISE EXCEPTION 'Funcionário não encontrado ou acesso negado';
    END IF;

    IF p_expected_version IS NOT NULL AND v_current_version != p_expected_version THEN
        RAISE EXCEPTION 'Erro de concorrência: O registro foi alterado por outro usuário.';
    END IF;

    -- Update fields
    UPDATE public.employees
    SET 
        name = COALESCE((p_values->>'name')::text, name),
        doc_cpf = CASE WHEN p_values ? 'doc_cpf' THEN (p_values->>'doc_cpf')::text ELSE doc_cpf END,
        doc_rg = CASE WHEN p_values ? 'doc_rg' THEN (p_values->>'doc_rg')::text ELSE doc_rg END,
        role_title = CASE WHEN p_values ? 'role_title' THEN (p_values->>'role_title')::text ELSE role_title END,
        department = CASE WHEN p_values ? 'department' THEN (p_values->>'department')::text ELSE department END,
        branch = CASE WHEN p_values ? 'branch' THEN (p_values->>'branch')::text ELSE branch END,
        cost_center = CASE WHEN p_values ? 'cost_center' THEN (p_values->>'cost_center')::text ELSE cost_center END,
        hire_date = CASE WHEN p_values ? 'hire_date' THEN (p_values->>'hire_date')::date ELSE hire_date END,
        status = COALESCE((p_values->>'status')::text, status),
        phone = CASE WHEN p_values ? 'phone' THEN (p_values->>'phone')::text ELSE phone END,
        email = CASE WHEN p_values ? 'email' THEN (p_values->>'email')::text ELSE email END,
        cnh_number = CASE WHEN p_values ? 'cnh_number' THEN (p_values->>'cnh_number')::text ELSE cnh_number END,
        cnh_category = CASE WHEN p_values ? 'cnh_category' THEN (p_values->>'cnh_category')::text ELSE cnh_category END,
        cnh_expiry = CASE WHEN p_values ? 'cnh_expiry' THEN (p_values->>'cnh_expiry')::date ELSE cnh_expiry END,
        medical_exam_expiry = CASE WHEN p_values ? 'medical_exam_expiry' THEN (p_values->>'medical_exam_expiry')::date ELSE medical_exam_expiry END,
        notes = CASE WHEN p_values ? 'notes' THEN (p_values->>'notes')::text ELSE notes END,
        updated_at = now(),
        updated_by = v_user_id,
        version = version + 1
    WHERE id = p_employee_id AND tenant_id = p_tenant_id;

    -- Audit trail
    PERFORM public._log_entity_audit(
        p_tenant_id, 
        'employee', 
        p_employee_id, 
        'update', 
        v_old_data, 
        p_values, 
        'hr_rpc'
    );
END;
$$;

-- 3. delete_employee_v1
CREATE OR REPLACE FUNCTION public.delete_employee_v1(
    p_tenant_id uuid,
    p_employee_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Auth Guard
    PERFORM public.check_tenant_membership(p_tenant_id);
    
    IF NOT public.is_tenant_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado: Apenas administradores podem excluir funcionários.';
    END IF;

    -- Dependency check (Checklists, Payroll, etc)
    IF EXISTS (SELECT 1 FROM public.payroll_entries WHERE employee_id = p_employee_id) THEN
        RAISE EXCEPTION 'Não é possível excluir: Funcionário possui histórico na folha de pagamento.';
    END IF;

    -- Audit before delete
    PERFORM public._log_entity_audit(
        p_tenant_id, 
        'employee', 
        p_employee_id, 
        'delete', 
        (SELECT to_jsonb(e.*) FROM public.employees e WHERE id = p_employee_id), 
        NULL, 
        'hr_rpc'
    );

    DELETE FROM public.employees WHERE id = p_employee_id AND tenant_id = p_tenant_id;
END;
$$;

-- Revoke DML and grant RPC access
REVOKE INSERT, UPDATE, DELETE ON public.employees FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_employee_v1(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_v1(uuid, uuid, jsonb, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_employee_v1(uuid, uuid) TO authenticated;