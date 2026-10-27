// What the store and the page share: the stores ledger, the visitor's chits
// and the slips Hester writes. The whole ledger is on the visitor's screen,
// so nothing here is secret and the store runs in the page.

export const DEPARTMENTS = ['Mechanical', 'Hydroponics', 'IT', 'Farms', 'Kitchens', 'Infirmary', 'Porters', 'Deputies', 'Residence'] as const;
export type Department = (typeof DEPARTMENTS)[number];

export interface Item {
  id: string;
  name: string;          // as the ledger writes it: "Pump gasket"
  aliases: string[];     // other words for it, said or misheard
  unit: string;          // "each", "pair", "spool"
  shelf: string;         // "C-4"
  count: number;         // on the shelf now
  chits: number;         // per unit
  only?: Department[];   // issued only to these departments
  limit?: number;        // most per slip (else MAX_PER_SLIP)
  note?: string;         // what Hester knows about it
  substitute?: string;   // another item's id, offered when this one is out
}

export interface Slip {
  no: string;            // "18-0417"
  status: 'stamped' | 'refused';
  itemId: string | null; // null when Hester refused something the ledger does not carry
  item: string;
  quantity: number;
  department: string;
  purpose: string;
  chits: number;         // what a stamped slip cost; 0 when refused
  reason?: string;       // why a slip was refused
}

export interface View {
  purse: number;
  startPurse: number;
  ledger: Item[];
  slips: Slip[];         // newest last
  lit: string | null;    // the ledger row Hester last looked up
}
