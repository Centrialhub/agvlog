import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

afterEach(cleanup);

function Choice() {
  return <Select defaultValue="a">
    <SelectTrigger aria-label="choice"><SelectValue /></SelectTrigger>
    <SelectContent><SelectItem value="a">Alpha</SelectItem><SelectItem value="b">Beta</SelectItem></SelectContent>
  </Select>;
}

async function choose() {
  const user=userEvent.setup();
  const trigger=screen.getByLabelText('choice');
  await user.click(trigger);
  await user.click(await screen.findByRole('option',{name:'Beta'}));
  expect(trigger).toHaveTextContent('Beta');
}

describe('Radix diagnostic',()=>{
  it('selects outside a dialog',async()=>{render(<Choice/>);await choose();});
  it('selects inside a dialog',async()=>{
    render(<Dialog defaultOpen><DialogContent>
      <DialogTitle>Escolha de diagnóstico</DialogTitle>
      <DialogDescription>Valida a interação do seletor dentro do diálogo.</DialogDescription>
      <Choice/>
    </DialogContent></Dialog>);
    await choose();
  });
});
