import {describe,expect,it} from 'vitest';
import {normalizeStateRegistration} from '@/lib/fiscalNormalization';
import {restoreStateRegistrationLeadingZeros} from '@/lib/stateRegistrationZeros';
import {buildClientIndex,resolveParty,fillPartyFieldsFromRegistry} from '@/lib/fiscal/partyRegistry';

describe('missing MG state registration leading zeros',()=>{
  it.each([
    ['623079040081','0623079040081'], // Official Sintegra example.
    ['32718520035','0032718520035'],
    ['15556230072','0015556230072'],
    ['10547160054','0010547160054'],
    ['15626050051','0015626050051'],
    ['28356130093','0028356130093'],
    ['47209890092','0047209890092'],
    ['55495160088','0055495160088'],
    ['35000780086','0035000780086'],
    ['32.718.520/035','0032718520035'],
  ])('restores %s without changing existing digits', (raw,expected)=>{
    expect(restoreStateRegistrationLeadingZeros(raw,'MG')).toBe(expected);
    expect(normalizeStateRegistration(raw,'MG')).toEqual({value:expected,unknown:false,isento:false});
  });
  it.each(['32718520036','32718520045','00000000000','12345','UNKNOWN','','O32718520035','IE 32718520035'])('does not manufacture a correction for %s',raw=>{
    expect(restoreStateRegistrationLeadingZeros(raw,'MG')).toBeNull();
  });
  it('checks both digits independently instead of accepting any 13-digit padding',()=>{
    for(let first=0;first<10;first++)for(let second=0;second<10;second++){
      const raw='327185200'+first+second;
      expect(restoreStateRegistrationLeadingZeros(raw,'MG')).toBe(first===3&&second===5?'0032718520035':null);
    }
  });
  it('preserves full-length and exempt registrations and does not pad an unknown/other UF',()=>{
    expect(normalizeStateRegistration('003.271.852/0035','MG').value).toBe('0032718520035');
    expect(normalizeStateRegistration('ISENTO','MG')).toMatchObject({value:'ISENTO',isento:true});
    for(const uf of [undefined,'SP','BA'])expect(restoreStateRegistrationLeadingZeros('32718520035',uf)).toBeNull();
    expect(restoreStateRegistrationLeadingZeros('0032718520035','MG')).toBeNull();
  });
  it.each([0,0.1,0.49])('does not trust an uncertain extraction with confidence %s',confidence=>{
    expect(normalizeStateRegistration('32718520035','MG',confidence).unknown).toBe(true);
  });
  it('corrects only the resolved establishment without mutating the source registry',()=>{
    const registry=[{id:'recipient',tax_id:'31459273000122',company_name:'Cliente',state_registration:'32718520035',address_state:'MG'}];
    const index=buildClientIndex(registry);
    expect(resolveParty(index,{cnpj:'31459273000122'})).toMatchObject({ie:'0032718520035'});
    expect(resolveParty(index,{name:'Cliente',cnpj:'31459273000203'})?.ie).toBeNull();
    expect(registry[0].state_registration).toBe('32718520035');
    const fields={recipientName:'Cliente',recipientCnpj:'31459273000122',recipientIe:'32718520035',recipientState:'MG',recipientCity:'',remitterName:'',remitterCnpj:'',remitterIe:''};
    const filled=fillPartyFieldsFromRegistry(fields,index);
    expect(filled.item.recipientIe).toBe('0032718520035');
    expect(filled.changed).toBe(true);
    expect(fields.recipientIe).toBe('32718520035');
  });
});
