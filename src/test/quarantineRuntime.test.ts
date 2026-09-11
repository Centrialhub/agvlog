// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {IMAGE_RUNTIME,loadImageRuntime} from '../../supabase/functions/secure-upload/quarantine-runtime';
it('requests only the fixed private runtime path and rejects wrong length',async()=>{
 const read=vi.fn(async()=>new Uint8Array([0,97,115,109]));
 await expect(loadImageRuntime(read)).rejects.toThrow('image_runtime_size_mismatch');expect(read).toHaveBeenCalledWith('upload-validation-runtime',IMAGE_RUNTIME.path);
});
it('rejects altered code even with the expected binary size',async()=>{
 await expect(loadImageRuntime(async()=>new Uint8Array(IMAGE_RUNTIME.size))).rejects.toThrow('image_runtime_hash_mismatch');
});
