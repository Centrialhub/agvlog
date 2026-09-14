import {calculateNfeAccessKeyCheckDigit} from '@/lib/fiscalDocuments/nfeAccessKey';
const firstFortyThree = '3526081234567800019055001000000123112345678';
const accessKey = `${firstFortyThree}${calculateNfeAccessKeyCheckDigit(firstFortyThree)}`;
export const payableNfeXml = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${accessKey}">
  <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-08-01T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>12345678000190</CNPJ><xNome>EMITENTE TESTE</xNome></emit>
  <dest><CNPJ>11222333000181</CNPJ><xNome>DESTINATARIO TESTE</xNome><enderDest><xLgr>RUA DESTINO</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><cMun>3509502</cMun><xMun>CAMPINAS</xMun><UF>SP</UF><CEP>13010000</CEP></enderDest></dest>
  <det nItem="1"><prod><xProd>PRODUTO TESTE</xProd><qCom>10.0000</qCom><uCom>UN</uCom><vUnCom>123.456</vUnCom><vProd>1234.56</vProd><NCM>12345678</NCM><CFOP>5102</CFOP></prod></det>
  <total><ICMSTot><vProd>1234.56</vProd><vNF>1234.56</vNF></ICMSTot></total>
  <transp><vol><qVol>2</qVol><pesoB>12.500</pesoB></vol><vol><qVol>3</qVol><pesoB>7.250</pesoB></vol></transp>
  <cobr><dup><nDup>001</nDup><dVenc>2026-08-31</dVenc><vDup>617.28</vDup></dup></cobr>
</infNFe></NFe></nfeProc>`;
