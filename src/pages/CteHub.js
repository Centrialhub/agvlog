import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileSpreadsheet, ShieldCheck, FileSearch } from 'lucide-react';
import Billing from '@/pages/Billing';
import CteMonitor from '@/pages/CteMonitor';
import CteSearch from '@/pages/CteSearch';
export default function CteHub() {
    const initialTab = typeof window !== 'undefined'
        ? (new URLSearchParams(window.location.search).get('tab') || 'faturamento')
        : 'faturamento';
    const [activeTab, setActiveTab] = useState(initialTab);
    const [searchParams] = useSearchParams();
    // Mantém a aba sincronizada quando outras telas navegam para ?tab=monitor|consulta.
    useEffect(() => {
        const tab = searchParams.get('tab');
        if (tab && tab !== activeTab)
            setActiveTab(tab);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);
    return (_jsxs("div", { className: "animate-fade-in space-y-6", children: [
            _jsxs("div", { children: [
                    _jsxs("h1", { className: "text-2xl font-bold text-foreground flex items-center gap-2", children: [
                            _jsx(FileSpreadsheet, { className: "h-6 w-6 text-primary" }),
                            " CT-e \u2014 Faturamento, Monitor e Consulta"] }), _jsx("p", { className: "text-sm text-muted-foreground", children: "Centralize a emiss\u00E3o, monitoramento e consulta de documentos CT-e em um \u00FAnico lugar." })
                ] }), _jsxs(Tabs, { value: activeTab, onValueChange: setActiveTab, className: "space-y-6", children: [
                    _jsxs(TabsList, { children: [
                            _jsxs(TabsTrigger, { value: "faturamento", className: "gap-2", children: [
                                    _jsx(FileSpreadsheet, { className: "h-4 w-4" }),
                                    " Faturamento"] }), _jsxs(TabsTrigger, { value: "monitor", className: "gap-2", children: [
                                    _jsx(ShieldCheck, { className: "h-4 w-4" }),
                                    " Monitor DOC-e"] }), _jsxs(TabsTrigger, { value: "consulta", className: "gap-2", children: [
                                    _jsx(FileSearch, { className: "h-4 w-4" }),
                                    " Consulta"] })
                        ] }), _jsx(TabsContent, { value: "faturamento", className: "mt-0", children: _jsx(Billing, {}) }), _jsx(TabsContent, { value: "monitor", className: "mt-0", children: _jsx(CteMonitor, {}) }), _jsx(TabsContent, { value: "consulta", className: "mt-0", children: _jsx(CteSearch, {}) })
                ] })
        ] }));
}
