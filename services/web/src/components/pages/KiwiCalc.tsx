import { useState, useEffect } from "react";

type KiwiVariety = "normal" | "gold";
type BinSize = "560" | "600";
type Currency = "EUR" | "NZD";

export default function KiwiCalc() {
  const [people, setPeople]       = useState("");
  const [totalBins, setTotalBins] = useState("");
  const [hoursWorked, setHoursWorked] = useState("");
  const [variety, setVariety]     = useState<KiwiVariety>("normal");
  const [binSize, setBinSize]     = useState<BinSize>("560");
  const [currency, setCurrency]   = useState<Currency>("EUR");
  const [includeHolidayBonus, setHolidayBonus] = useState(false);
  const [taxAmount, setTaxAmount] = useState("17");
  const [subtractTax, setSubtractTax] = useState(false);

  const [binsPerPersonTotal, setBinsPerPersonTotal]        = useState<number | null>(null);
  const [binsPerPersonPerHour, setBinsPerPersonPerHour]   = useState<number | null>(null);
  const [earningsTotal, setEarningsTotal]                 = useState<number | null>(null);
  const [earningsPerHour, setEarningsPerHour]             = useState<number | null>(null);


  const GA_560l = 28.0;
  const GA_600l = 30.5;
  const HW_560l = 25.18;
  const HW_600l = 27.54;

  useEffect(() => {
    function recalculate() {
        const binsPerPerson = Number(people) > 0 && Number(totalBins) > 0 ? Number(totalBins) / Number(people) : null;
        setBinsPerPersonTotal(binsPerPerson);
      
        const binsPerPersonPerHour =  (binsPerPerson && Number(hoursWorked) > 0) ? binsPerPerson / Number(hoursWorked) : null;
      setBinsPerPersonPerHour(binsPerPersonPerHour);


      let totalEarnings = 0;
      if(binsPerPerson)
        {
             switch(binSize)
             {
                case "560":
                    if(variety == "normal") totalEarnings = HW_560l;
                    else totalEarnings  = GA_560l;
                    break;
                case "600":
                    if(variety == "normal") totalEarnings = HW_600l;
                    else totalEarnings = GA_600l;
                    break;
                default:
                    break;
             }
             if(includeHolidayBonus) totalEarnings*=1.08;
             
             if(currency == "EUR") totalEarnings /= 2;

             totalEarnings *= binsPerPerson;

             if(subtractTax) totalEarnings -= (totalEarnings * (Number(taxAmount) / 100));
             setEarningsTotal(totalEarnings);
        }
        else setEarningsTotal(null);

        if(binsPerPersonPerHour)
        {
            setEarningsPerHour(totalEarnings/Number(hoursWorked));

        }
      else setEarningsPerHour(null);
    }
    recalculate();
  }, [people, totalBins, variety, binSize, currency, hoursWorked, includeHolidayBonus, subtractTax, taxAmount]);

  const symbol = currency === "EUR" ? "€" : "$";

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-6 flex flex-col gap-6 max-w-lg w-full">

         {/* Title */}
        <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900">
             🥝 No dropping guuuyys 🥝
            </h2>
        </div>

      {/* Row 1 — numeric inputs */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="People">
          <input
            type="number" min={1} value={people} placeholder="e.g. 10" 
            onChange={(e) => setPeople(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-400"
          />
        </Field>
        <Field label="Total bins">
          <input
            type="number" min={1} value={totalBins} placeholder="e.g. 1000"
            onChange={(e) => setTotalBins(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-400"
          />
        </Field>
        <Field label="Hours worked">
          <input
            type="number" min={1} value={hoursWorked} placeholder="e.g. 8"
            onChange={(e) => setHoursWorked(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-400"
          />
        </Field>
        <Field label="Tax Percentage (1-100)">
          <input
            type="number" min={1} value={taxAmount} placeholder="e.g. 17"
            onChange={(e) => setTaxAmount(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-400"
          />
        </Field>
      </div>

      {/* Row 2 — selects */}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Variety">
          <select
            value={variety} onChange={(e) => setVariety(e.target.value as KiwiVariety)}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-400"
          >
            <option value="normal">Normal / Red</option>
            <option value="gold">Gold Kiwi</option>
          </select>
        </Field>
        <Field label="Bin size">
          <select
            value={binSize} onChange={(e) => setBinSize(e.target.value as BinSize)}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-400"
          >
            <option value="560">560 L</option>
            <option value="600">600 L</option>
          </select>
        </Field>
        <Field label="Currency">
          <select
            value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-400"
          >
            <option value="EUR">€ Euro</option>
            <option value="NZD">$ NZD</option>
          </select>
        </Field>
      </div>

    { /* Check Boxes */}
    <div className="grid grid-cols-2 gap-3">
    <label className="flex items-center gap-3 cursor-pointer rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 hover:bg-zinc-100 transition">
        
        <input
        type="checkbox"
        checked={subtractTax}
        onChange={(e) => setSubtractTax(e.target.checked)}
        className="h-5 w-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400"
        />

        <span className="text-sm text-zinc-800 font-medium">
        Subtract Tax
        </span>

    </label>
        <label className="flex items-center gap-3 cursor-pointer rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 hover:bg-zinc-100 transition">
        
        <input
        type="checkbox"
        checked={includeHolidayBonus}
        onChange={(e) => setHolidayBonus(e.target.checked)}
        className="h-5 w-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400"
        />

        <span className="text-sm text-zinc-800 font-medium">
        Include 8% Holiday Pay
        </span>

    </label>
    </div>

      {/* Divider */}
      <div className="border-t border-zinc-100" />

      {/* Results */}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Bins / person total"    value={binsPerPersonTotal ? Number(binsPerPersonTotal.toFixed(2)) : null} />
        <Stat label="Bins / person / hour"   value={binsPerPersonPerHour ? Number(binsPerPersonPerHour.toFixed(2)) : null} />
        <Stat label="Earnings total"         value={earningsTotal ? Number(earningsTotal?.toFixed(2)) : null}    prefix={symbol} />
        <Stat label="Earnings / hour"        value={earningsPerHour ? Number(earningsPerHour?.toFixed(2)) : null}  prefix={symbol} />
      </div>

    </div>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

function Field({ label, children } : FieldProps ) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
        {label}
      </span>
      {children}
    </div>
  );
}

interface StatProps {
  label: string;
  value: number | null;
  prefix?: string;
}

function Stat({ label, value, prefix = "" } : StatProps) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-zinc-50 px-4 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
        {label}
      </span>
      <span className="text-2xl font-semibold text-zinc-900">
        {value !== null ? `${prefix}${value}` : "—"}
      </span>
    </div>
  );
}