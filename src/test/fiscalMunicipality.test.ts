import {describe,expect,it} from 'vitest';
import {isSameFiscalMunicipality} from '@/lib/fiscal/fiscalMunicipality';

describe('consistent fiscal destination classification',()=>{
  const emitter={city:'MONTES CLAROS',state:'MG',code:'3143302'};
  it.each([
    ['443663','ITAMARANDIBA'],['444796','JAIBA'],['444797','CATUTI'],['444798','TAIOBEIRAS'],
    ['446066','JANAUBA'],['446068','TAIOBEIRAS'],['446069','TAIOBEIRAS'],['446070','JANAUBA'],
    ['446071','TAIOBEIRAS'],['446072','PORTEIRINHA'],['446083','CRISTALIA'],
  ])('keeps NF %s eligible for CT-e when a stale registry code conflicts with %s',(_number,city)=>{
    const source={city,state:'MG'};
    const preview={...source,code:'3143302'};
    expect(isSameFiscalMunicipality(source,emitter)).toBe(false);
    expect(isSameFiscalMunicipality(preview,emitter)).toBe(false);
  });
  it('still routes a real local destination to NFS-e, despite a stale code',()=>{
    expect(isSameFiscalMunicipality({city:'Montes Claros / MG',state:'Minas Gerais',code:'3168002'},emitter)).toBe(true);
  });
  it('does not conflate different states even with equal stale codes',()=>{
    expect(isSameFiscalMunicipality({city:'Montes Claros',state:'GO',code:'3143302'},emitter)).toBe(false);
  });
  it('uses IBGE as fallback only when names are unavailable and never matches missing data',()=>{
    expect(isSameFiscalMunicipality({code:'3143302'},emitter)).toBe(true);
    expect(isSameFiscalMunicipality({code:'3168002'},emitter)).toBe(false);
    expect(isSameFiscalMunicipality({},{})).toBe(false);
  });
});
