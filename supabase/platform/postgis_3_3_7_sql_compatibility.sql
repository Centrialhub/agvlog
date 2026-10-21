-- SPDX-License-Identifier: GPL-2.0-or-later
-- Derived from PostGIS 3.3.7 SQL definitions; see adjacent provenance.
-- Requires the existing platform owner. Never grant its role to application users.
-- Not an ordinary postgres migration: production needs an owner-operated rollout.
BEGIN;
SET LOCAL search_path=public,extensions;
CREATE TEMPORARY TABLE qa_postgis_compatibility_targets(signature text,before_md5 text,after_md5 text) ON COMMIT DROP;
INSERT INTO qa_postgis_compatibility_targets VALUES
('extensions.st_findextent(text,text,text)','c0f74a0239e0b86c5f65164a71291d94','23a27d7956698e6c1d7aa51086ebf6d6'),
('extensions.st_findextent(text,text)','f1de6770ce18eafb12bd2a4783cac9f7','4010854f1bcb5197b9b23d2ccd948131'),
('extensions.populate_geometry_columns(oid,boolean)','2c339fb1e3287ec843258759b18be75b','ae0cc1d2496e7cc4fec1435e2e4d12bc'),
('extensions.postgis_full_version()','5608ccd23d605d59d95546c6df2b92f2','71fa4302d0415af1a3b7ee20fcc2be01'),
('extensions.addauth(text)','06714c876a40f42a81bff04f169f8a88','1abfa406990f7fdd336b1bf21bc890f9'),
('extensions.lockrow(text,text,text,text,timestamp without time zone)','e5e3eed300f4517ccf744064d8c74200','04c71288f8ebe05a3e44dd3a84442938');
DO $platform_preimage$
BEGIN
 IF current_user<>'supabase_admin' OR NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis' AND extversion='3.3.7') THEN RAISE EXCEPTION 'postgis_compatibility_platform_owner_and_version_required'; END IF;
 IF EXISTS(SELECT 1 FROM qa_postgis_compatibility_targets t LEFT JOIN pg_proc p ON p.oid=to_regprocedure(t.signature) WHERE p.oid IS NULL OR pg_get_userbyid(p.proowner)<>'supabase_admin' OR md5(p.prosrc) NOT IN(t.before_md5,t.after_md5)) THEN RAISE EXCEPTION 'postgis_compatibility_preimage_changed'; END IF;
END;
$platform_preimage$;
CREATE TEMPORARY TABLE qa_postgis_contract_before ON COMMIT DROP AS SELECT p.oid,p.proname,p.pronamespace,p.proowner,p.prolang,p.procost,p.prorows,p.provariadic,p.prosupport,p.prokind,p.prosecdef,p.proleakproof,p.proisstrict,p.proretset,p.provolatile,p.proparallel,p.pronargs,p.pronargdefaults,p.prorettype,p.proargtypes::text,p.proallargtypes,p.proargmodes,p.proargnames,p.proargdefaults::text,p.proconfig,p.proacl::text FROM pg_proc p WHERE p.oid IN(SELECT to_regprocedure(signature) FROM qa_postgis_compatibility_targets);

CREATE OR REPLACE FUNCTION extensions.st_findextent(text, text, text)
 RETURNS box2d
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE STRICT
AS $function$
DECLARE
	schemaname alias for $1;
	tablename alias for $2;
	columnname alias for $3;
	extent extensions.box2d;
BEGIN
	EXECUTE format('SELECT extensions.ST_Extent(%I) FROM %I.%I',columnname,schemaname,tablename) INTO extent;
	RETURN extent;
END;
$function$;

CREATE OR REPLACE FUNCTION extensions.st_findextent(text, text)
 RETURNS box2d
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE STRICT
AS $function$
DECLARE
	tablename alias for $1;
	columnname alias for $2;
	extent extensions.box2d;

BEGIN
	EXECUTE format('SELECT extensions.ST_Extent(%I) FROM %I',columnname,tablename) INTO extent;
	RETURN extent;
END;
$function$;

CREATE OR REPLACE FUNCTION extensions.populate_geometry_columns(tbl_oid oid, use_typmod boolean DEFAULT true)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
	gcs		 RECORD;
	gc		  RECORD;
	gc_old	  RECORD;
	gsrid	   integer;
	gndims	  integer;
	gtype	   text;
	query	   text;
	gc_is_valid boolean;
	inserted	integer;
	constraint_successful boolean := false;

BEGIN
	inserted := 0;

	-- Iterate through all geometry columns in this table
	FOR gcs IN
	SELECT n.nspname, c.relname, a.attname, c.relkind
		FROM pg_class c,
			 pg_attribute a,
			 pg_type t,
			 pg_namespace n
		WHERE c.relkind IN('r', 'f', 'p')
		AND t.typname = 'geometry'
		AND a.attisdropped = false
		AND a.atttypid = t.oid
		AND a.attrelid = c.oid
		AND c.relnamespace = n.oid
		AND n.nspname NOT ILIKE 'pg_temp%'
		AND c.oid = tbl_oid
	LOOP

		RAISE DEBUG 'Processing column %.%.%', gcs.nspname, gcs.relname, gcs.attname;

		gc_is_valid := true;
		-- Find the srid, coord_dimension, and type of current geometry
		-- in geometry_columns -- which is now a view

		SELECT type, srid, coord_dimension, gcs.relkind INTO gc_old
			FROM geometry_columns
			WHERE f_table_schema = gcs.nspname AND f_table_name = gcs.relname AND f_geometry_column = gcs.attname;

		IF upper(gc_old.type) = 'GEOMETRY' THEN
		-- This is an unconstrained geometry we need to do something
		-- We need to figure out what to set the type by inspecting the data
			EXECUTE 'SELECT extensions.ST_srid(' || quote_ident(gcs.attname) || ') As srid, extensions.GeometryType(' || quote_ident(gcs.attname) || ') As type, extensions.ST_NDims(' || quote_ident(gcs.attname) || ') As dims ' ||
					 ' FROM ONLY ' || quote_ident(gcs.nspname) || '.' || quote_ident(gcs.relname) ||
					 ' WHERE ' || quote_ident(gcs.attname) || ' IS NOT NULL LIMIT 1;'
				INTO gsrid,gtype,gndims;
			IF gsrid IS NULL AND gtype IS NULL AND gndims IS NULL THEN -- there is no data so we can not determine geometry type
				RAISE WARNING 'No data in table %.%, so no information to determine geometry type and srid', gcs.nspname, gcs.relname;
				RETURN 0;
			END IF;


			IF use_typmod THEN
				BEGIN
					EXECUTE 'ALTER TABLE ' || quote_ident(gcs.nspname) || '.' || quote_ident(gcs.relname) || ' ALTER COLUMN ' || quote_ident(gcs.attname) ||
						' TYPE geometry(' || postgis_type_name(gtype, gndims, true) || ', ' || gsrid::text  || ') ';
					inserted := inserted + 1;
				EXCEPTION
						WHEN invalid_parameter_value OR feature_not_supported THEN
						RAISE WARNING 'Could not convert ''%'' in ''%.%'' to use typmod with srid %, type %: %', quote_ident(gcs.attname), quote_ident(gcs.nspname), quote_ident(gcs.relname), gsrid, postgis_type_name(gtype, gndims, true), SQLERRM;
							gc_is_valid := false;
				END;

			ELSE
				-- Try to apply srid check to column
				constraint_successful = false;
				IF (gsrid > 0 AND postgis_constraint_srid(gcs.nspname, gcs.relname,gcs.attname) IS NULL ) THEN
					BEGIN
						EXECUTE 'ALTER TABLE ONLY ' || quote_ident(gcs.nspname) || '.' || quote_ident(gcs.relname) ||
								 ' ADD CONSTRAINT ' || quote_ident('enforce_srid_' || gcs.attname) ||
								 ' CHECK (ST_srid(' || quote_ident(gcs.attname) || ') = ' || gsrid || ')';
						constraint_successful := true;
					EXCEPTION
						WHEN check_violation THEN
							RAISE WARNING 'Not inserting ''%'' in ''%.%'' into geometry_columns: could not apply constraint CHECK (st_srid(%) = %)', quote_ident(gcs.attname), quote_ident(gcs.nspname), quote_ident(gcs.relname), quote_ident(gcs.attname), gsrid;
							gc_is_valid := false;
					END;
				END IF;

				-- Try to apply ndims check to column
				IF (gndims IS NOT NULL AND postgis_constraint_dims(gcs.nspname, gcs.relname,gcs.attname) IS NULL ) THEN
					BEGIN
						EXECUTE 'ALTER TABLE ONLY ' || quote_ident(gcs.nspname) || '.' || quote_ident(gcs.relname) || '
								 ADD CONSTRAINT ' || quote_ident('enforce_dims_' || gcs.attname) || '
								 CHECK (st_ndims(' || quote_ident(gcs.attname) || ') = '||gndims||')';
						constraint_successful := true;
					EXCEPTION
						WHEN check_violation THEN
							RAISE WARNING 'Not inserting ''%'' in ''%.%'' into geometry_columns: could not apply constraint CHECK (st_ndims(%) = %)', quote_ident(gcs.attname), quote_ident(gcs.nspname), quote_ident(gcs.relname), quote_ident(gcs.attname), gndims;
							gc_is_valid := false;
					END;
				END IF;

				-- Try to apply geometrytype check to column
				IF (gtype IS NOT NULL AND postgis_constraint_type(gcs.nspname, gcs.relname,gcs.attname) IS NULL ) THEN
					BEGIN
						EXECUTE 'ALTER TABLE ONLY ' || quote_ident(gcs.nspname) || '.' || quote_ident(gcs.relname) || '
						ADD CONSTRAINT ' || quote_ident('enforce_geotype_' || gcs.attname) || '
						CHECK (geometrytype(' || quote_ident(gcs.attname) || ') = ' || quote_literal(gtype) || ')';
						constraint_successful := true;
					EXCEPTION
						WHEN check_violation THEN
							-- No geometry check can be applied. This column contains a number of geometry types.
							RAISE WARNING 'Could not add geometry type check (%) to table column: %.%.%', gtype, quote_ident(gcs.nspname),quote_ident(gcs.relname),quote_ident(gcs.attname);
					END;
				END IF;
				 --only count if we were successful in applying at least one constraint
				IF constraint_successful THEN
					inserted := inserted + 1;
				END IF;
			END IF;
		END IF;

	END LOOP;

	RETURN inserted;
END

$function$;

CREATE OR REPLACE FUNCTION extensions.postgis_full_version()
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
 v_optional regprocedure;
	libver text;
	librev text;
	projver text;
	geosver text;
	sfcgalver text;
	gdalver text := NULL;
	libxmlver text;
	liblwgeomver text;
	dbproc text;
	relproc text;
	fullver text;
	rast_lib_ver text := NULL;
	rast_scr_ver text := NULL;
	topo_scr_ver text := NULL;
	json_lib_ver text;
	protobuf_lib_ver text;
	wagyu_lib_ver text;
	sfcgal_lib_ver text;
	sfcgal_scr_ver text;
	pgsql_scr_ver text;
	pgsql_ver text;
	core_is_extension bool;
BEGIN
	SELECT extensions.postgis_lib_version() INTO libver;
	SELECT extensions.postgis_proj_version() INTO projver;
	SELECT extensions.postgis_geos_version() INTO geosver;
	SELECT extensions.postgis_libjson_version() INTO json_lib_ver;
	SELECT extensions.postgis_libprotobuf_version() INTO protobuf_lib_ver;
	SELECT extensions.postgis_wagyu_version() INTO wagyu_lib_ver;
	SELECT extensions._postgis_scripts_pgsql_version() INTO pgsql_scr_ver;
	SELECT extensions._postgis_pgsql_version() INTO pgsql_ver;
	BEGIN
		v_optional := to_regprocedure('extensions.postgis_gdal_version()');
 IF v_optional IS NULL THEN RAISE undefined_function; END IF;
 EXECUTE 'SELECT '||v_optional::text INTO gdalver;
	EXCEPTION
		WHEN undefined_function THEN
			RAISE DEBUG 'Function postgis_gdal_version() not found.  Is raster support enabled and rtpostgis.sql installed?';
	END;
	BEGIN
		v_optional := to_regprocedure('extensions.postgis_sfcgal_full_version()');
 IF v_optional IS NULL THEN RAISE undefined_function; END IF;
 EXECUTE 'SELECT '||v_optional::text INTO sfcgalver;
		BEGIN
			v_optional := to_regprocedure('extensions.postgis_sfcgal_scripts_installed()');
 IF v_optional IS NULL THEN RAISE undefined_function; END IF;
 EXECUTE 'SELECT '||v_optional::text INTO sfcgal_scr_ver;
		EXCEPTION
			WHEN undefined_function THEN
				sfcgal_scr_ver := 'missing';
		END;
	EXCEPTION
		WHEN undefined_function THEN
			RAISE DEBUG 'Function postgis_sfcgal_scripts_installed() not found. Is sfcgal support enabled and sfcgal.sql installed?';
	END;
	SELECT extensions.postgis_liblwgeom_version() INTO liblwgeomver;
	SELECT extensions.postgis_libxml_version() INTO libxmlver;
	SELECT extensions.postgis_scripts_installed() INTO dbproc;
	SELECT extensions.postgis_scripts_released() INTO relproc;
	SELECT extensions.postgis_lib_revision() INTO librev;
	BEGIN
		v_optional := to_regprocedure('topology.postgis_topology_scripts_installed()');
 IF v_optional IS NULL THEN RAISE undefined_function; END IF;
 EXECUTE 'SELECT '||v_optional::text INTO topo_scr_ver;
	EXCEPTION
		WHEN undefined_function OR invalid_schema_name THEN
			RAISE DEBUG 'Function postgis_topology_scripts_installed() not found. Is topology support enabled and topology.sql installed?';
		WHEN insufficient_privilege THEN
			RAISE NOTICE 'Topology support cannot be inspected. Is current user granted USAGE on schema "topology" ?';
		WHEN OTHERS THEN
			RAISE NOTICE 'Function postgis_topology_scripts_installed() could not be called: % (%)', SQLERRM, SQLSTATE;
	END;

	BEGIN
		v_optional := to_regprocedure('postgis_raster_scripts_installed()');
 IF v_optional IS NULL THEN RAISE undefined_function; END IF;
 EXECUTE 'SELECT '||v_optional::text INTO rast_scr_ver;
	EXCEPTION
		WHEN undefined_function THEN
			RAISE DEBUG 'Function postgis_raster_scripts_installed() not found. Is raster support enabled and rtpostgis.sql installed?';
		WHEN OTHERS THEN
			RAISE NOTICE 'Function postgis_raster_scripts_installed() could not be called: % (%)', SQLERRM, SQLSTATE;
	END;

	BEGIN
		v_optional := to_regprocedure('extensions.postgis_raster_lib_version()');
 IF v_optional IS NULL THEN RAISE undefined_function; END IF;
 EXECUTE 'SELECT '||v_optional::text INTO rast_lib_ver;
	EXCEPTION
		WHEN undefined_function THEN
			RAISE DEBUG 'Function postgis_raster_lib_version() not found. Is raster support enabled and rtpostgis.sql installed?';
		WHEN OTHERS THEN
			RAISE NOTICE 'Function postgis_raster_lib_version() could not be called: % (%)', SQLERRM, SQLSTATE;
	END;

	fullver = 'POSTGIS="' || libver;

	IF  librev IS NOT NULL THEN
		fullver = fullver || ' ' || librev;
	END IF;

	fullver = fullver || '"';

	IF EXISTS (
		SELECT * FROM pg_catalog.pg_extension
		WHERE extname = 'postgis')
	THEN
			fullver = fullver || ' [EXTENSION]';
			core_is_extension := true;
	ELSE
			core_is_extension := false;
	END IF;

	IF liblwgeomver != relproc THEN
		fullver = fullver || ' (liblwgeom version mismatch: "' || liblwgeomver || '")';
	END IF;

	fullver = fullver || ' PGSQL="' || pgsql_scr_ver || '"';
	IF pgsql_scr_ver != pgsql_ver THEN
		fullver = fullver || ' (procs need upgrade for use with PostgreSQL "' || pgsql_ver || '")';
	END IF;

	IF  geosver IS NOT NULL THEN
		fullver = fullver || ' GEOS="' || geosver || '"';
	END IF;

	IF  sfcgalver IS NOT NULL THEN
		fullver = fullver || ' SFCGAL="' || sfcgalver || '"';
	END IF;

	IF  projver IS NOT NULL THEN
		fullver = fullver || ' PROJ="' || projver || '"';
	END IF;

	IF  gdalver IS NOT NULL THEN
		fullver = fullver || ' GDAL="' || gdalver || '"';
	END IF;

	IF  libxmlver IS NOT NULL THEN
		fullver = fullver || ' LIBXML="' || libxmlver || '"';
	END IF;

	IF json_lib_ver IS NOT NULL THEN
		fullver = fullver || ' LIBJSON="' || json_lib_ver || '"';
	END IF;

	IF protobuf_lib_ver IS NOT NULL THEN
		fullver = fullver || ' LIBPROTOBUF="' || protobuf_lib_ver || '"';
	END IF;

	IF wagyu_lib_ver IS NOT NULL THEN
		fullver = fullver || ' WAGYU="' || wagyu_lib_ver || '"';
	END IF;

	IF dbproc != relproc THEN
		fullver = fullver || ' (core procs from "' || dbproc || '" need upgrade)';
	END IF;

	IF topo_scr_ver IS NOT NULL THEN
		fullver = fullver || ' TOPOLOGY';
		IF topo_scr_ver != relproc THEN
			fullver = fullver || ' (topology procs from "' || topo_scr_ver || '" need upgrade)';
		END IF;
		IF core_is_extension AND NOT EXISTS (
			SELECT * FROM pg_catalog.pg_extension
			WHERE extname = 'postgis_topology')
		THEN
				fullver = fullver || ' [UNPACKAGED!]';
		END IF;
	END IF;

	IF rast_lib_ver IS NOT NULL THEN
		fullver = fullver || ' RASTER';
		IF rast_lib_ver != relproc THEN
			fullver = fullver || ' (raster lib from "' || rast_lib_ver || '" need upgrade)';
		END IF;
		IF core_is_extension AND NOT EXISTS (
			SELECT * FROM pg_catalog.pg_extension
			WHERE extname = 'postgis_raster')
		THEN
				fullver = fullver || ' [UNPACKAGED!]';
		END IF;
	END IF;

	IF rast_scr_ver IS NOT NULL AND rast_scr_ver != relproc THEN
		fullver = fullver || ' (raster procs from "' || rast_scr_ver || '" need upgrade)';
	END IF;

	IF sfcgal_scr_ver IS NOT NULL AND sfcgal_scr_ver != relproc THEN
		fullver = fullver || ' (sfcgal procs from "' || sfcgal_scr_ver || '" need upgrade)';
	END IF;

	-- Check for the presence of deprecated functions
	IF EXISTS ( SELECT oid FROM pg_catalog.pg_proc WHERE proname LIKE '%_deprecated_by_postgis_%' )
	THEN
		fullver = fullver || ' (deprecated functions exist, upgrade is not complete)';
	END IF;

	RETURN fullver;
END
$function$;

CREATE OR REPLACE FUNCTION extensions.addauth(text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
	lockid alias for $1;
	okay boolean;
	myrec record;
BEGIN
	-- check to see if table exists
	--  if not, CREATE TEMP TABLE mylock (transid xid, lockcode text)
	okay := 'f';
	FOR myrec IN SELECT * FROM pg_class WHERE oid = to_regclass('pg_temp.temp_lock_have_table') LOOP
		okay := 't';
	END LOOP;
	IF (okay <> 't') THEN
		CREATE TEMP TABLE temp_lock_have_table (transid xid, lockcode text);
			-- this will only work from pgsql7.4 up
			-- ON COMMIT DELETE ROWS;
	END IF;

	--  INSERT INTO mylock VALUES ( $1)
--	EXECUTE 'INSERT INTO temp_lock_have_table VALUES ( '||
--		quote_literal(getTransactionID()) || ',' ||
--		quote_literal(lockid) ||')';

	EXECUTE 'INSERT INTO pg_temp.temp_lock_have_table VALUES (extensions.getTransactionID(),'||quote_nullable(lockid)||')';

	RETURN true::boolean;
END;
$function$;

CREATE OR REPLACE FUNCTION extensions.lockrow(text, text, text, text, timestamp without time zone)
 RETURNS integer
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
	myschema alias for $1;
	mytable alias for $2;
	myrid   alias for $3;
	authid alias for $4;
	expires alias for $5;
	ret int;
	mytoid oid;
	my_auth text;
 v_authorization regclass;

BEGIN

	IF NOT LongTransactionsEnabled() THEN
		RAISE EXCEPTION 'Long transaction support disabled, use EnableLongTransaction() to enable.';
	END IF;

	SELECT c.oid::regclass INTO v_authorization FROM pg_class c WHERE c.oid=to_regclass('authorization_table');
 IF v_authorization IS NULL THEN RAISE EXCEPTION 'authorization_table does not exist' USING ERRCODE='42P01'; END IF;
 EXECUTE format('DELETE FROM %s WHERE expires < $1',v_authorization) USING now();

	SELECT c.oid INTO mytoid FROM pg_class c, pg_namespace n
		WHERE c.relname = mytable
		AND c.relnamespace = n.oid
		AND n.nspname = myschema;

	-- RAISE NOTICE 'toid: %', mytoid;

	FOR my_auth IN EXECUTE format('SELECT authid FROM %s WHERE toid=$1 AND rid=$2',v_authorization) USING mytoid,myrid
	LOOP
		IF my_auth != authid THEN
			RETURN 0;
		ELSE
			RETURN 1;
		END IF;
	END LOOP;

	EXECUTE format('INSERT INTO %s VALUES ($1,$2,$3,$4)',v_authorization) USING mytoid,myrid,expires,authid;

	GET DIAGNOSTICS ret = ROW_COUNT;

	RETURN ret;
END;
$function$;

DO $platform_contract$
BEGIN
 IF EXISTS((SELECT * FROM qa_postgis_contract_before EXCEPT SELECT p.oid,p.proname,p.pronamespace,p.proowner,p.prolang,p.procost,p.prorows,p.provariadic,p.prosupport,p.prokind,p.prosecdef,p.proleakproof,p.proisstrict,p.proretset,p.provolatile,p.proparallel,p.pronargs,p.pronargdefaults,p.prorettype,p.proargtypes::text,p.proallargtypes,p.proargmodes,p.proargnames,p.proargdefaults::text,p.proconfig,p.proacl::text FROM pg_proc p WHERE p.oid IN(SELECT to_regprocedure(signature) FROM qa_postgis_compatibility_targets)) UNION ALL (SELECT p.oid,p.proname,p.pronamespace,p.proowner,p.prolang,p.procost,p.prorows,p.provariadic,p.prosupport,p.prokind,p.prosecdef,p.proleakproof,p.proisstrict,p.proretset,p.provolatile,p.proparallel,p.pronargs,p.pronargdefaults,p.prorettype,p.proargtypes::text,p.proallargtypes,p.proargmodes,p.proargnames,p.proargdefaults::text,p.proconfig,p.proacl::text FROM pg_proc p WHERE p.oid IN(SELECT to_regprocedure(signature) FROM qa_postgis_compatibility_targets) EXCEPT SELECT * FROM qa_postgis_contract_before)) THEN RAISE EXCEPTION 'postgis_compatibility_api_owner_or_acl_changed'; END IF;
 IF EXISTS(SELECT 1 FROM qa_postgis_compatibility_targets t JOIN pg_proc p ON p.oid=to_regprocedure(t.signature) WHERE md5(p.prosrc)<>t.after_md5) THEN RAISE EXCEPTION 'postgis_compatibility_result_changed'; END IF;
END;
$platform_contract$;
COMMIT;
