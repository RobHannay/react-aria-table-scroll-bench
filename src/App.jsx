import { useEffect } from 'react';
import { Cell, Column, Row, Table, TableBody, TableHeader, TableLayout, Virtualizer } from 'react-aria-components';

const params = new URLSearchParams(location.search);
const CELLS = params.get('cells') ?? 'trivial'; // trivial | realistic
const SIZING = params.get('sizing') ?? 'fixed'; // fixed | estimated
const ROWS = Number(params.get('rows') ?? 2000);
const COLS = Number(params.get('cols') ?? 15);

const columns = Array.from({ length: COLS }, (_, i) => ({ id: `c${i}`, name: `Column ${i + 1}`, isRowHeader: i === 0 }));
const STATUSES = ['Active', 'Pending', 'Archived', 'Draft'];
const rows = Array.from({ length: ROWS }, (_, r) => {
    const row = { id: `r${r}` };
    for (let c = 0; c < COLS; c++) row[`c${c}`] = `R${r} C${c} ${((r * 7919 + c * 104729) % 100000).toString(36)}`;
    row.status = STATUSES[r % STATUSES.length];
    row.score = (r * 37) % 100;
    return row;
});

const layoutOptions =
    SIZING === 'fixed' ? { rowHeight: 40, headingHeight: 36 } : { estimatedRowHeight: 40, headingHeight: 36 };

const styles = {
    table: { width: 1400, height: 800, overflow: 'auto', border: '1px solid #ccc', display: 'block', position: 'relative' },
    cell: { padding: '0 8px', display: 'flex', alignItems: 'center', height: '100%', overflow: 'hidden', whiteSpace: 'nowrap', borderBottom: '1px solid #eee' },
    estCell: { padding: '10px 8px', display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap', borderBottom: '1px solid #eee', boxSizing: 'border-box', height: 40 },
    badge: { display: 'inline-flex', padding: '1px 6px', borderRadius: 10, background: '#e6f0ff', color: '#1d4ed8', fontSize: 11, fontWeight: 600, marginInlineEnd: 6 },
    icon: { flexShrink: 0, marginInlineEnd: 6 },
    muted: { color: '#666', fontSize: 11, marginInlineStart: 4 },
    meter: { display: 'inline-block', width: 30, height: 4, background: '#eee', borderRadius: 2, marginInlineStart: 6, overflow: 'hidden' },
};

function Icon({ kind }) {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" style={styles.icon} aria-hidden="true">
            {kind === 0 ? <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /> : <path d="M2 8h12M8 2v12" stroke="currentColor" strokeWidth="1.5" />}
        </svg>
    );
}

function RichCell({ row, col, colIndex }) {
    const text = row[col.id];
    const [head, ...rest] = text.split(' ');
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', minWidth: 0 }}>
            <Icon kind={colIndex % 2} />
            {colIndex % 3 === 0 ? <span style={styles.badge}>{row.status}</span> : null}
            <span>
                <strong>{head}</strong> <em>{rest.join(' ')}</em>
            </span>
            {colIndex % 4 === 1 ? (
                <span style={styles.meter}>
                    <span style={{ display: 'block', width: `${row.score}%`, height: '100%', background: '#16a34a' }} />
                </span>
            ) : null}
            <span style={styles.muted}>#{colIndex}</span>
        </span>
    );
}

function renderCell(row, col, colIndex) {
    const style = SIZING === 'fixed' ? styles.cell : styles.estCell;
    return (
        <Cell style={style}>
            {CELLS === 'realistic' ? <RichCell row={row} col={col} colIndex={colIndex} /> : row[col.id]}
        </Cell>
    );
}

export function App() {
    useEffect(() => {
        requestAnimationFrame(() => requestAnimationFrame(() => (window.__ready = true)));
    }, []);
    return (
        <Virtualizer layout={TableLayout} layoutOptions={layoutOptions}>
            <Table aria-label="Experiment table" data-testid="table" style={styles.table}>
                <TableHeader columns={columns}>
                    {(col) => (
                        <Column id={col.id} isRowHeader={col.isRowHeader} width={140} style={{ textAlign: 'start', fontWeight: 600, background: '#fafafa', padding: '0 8px' }}>
                            {col.name}
                        </Column>
                    )}
                </TableHeader>
                <TableBody items={rows}>
                    {(row) => (
                        <Row id={row.id} columns={columns} style={{ background: '#fff' }}>
                            {(col) => renderCell(row, col, columns.indexOf(col))}
                        </Row>
                    )}
                </TableBody>
            </Table>
        </Virtualizer>
    );
}
