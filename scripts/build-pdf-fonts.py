"""
Erzeugt die Schriften für den PDF-Export: fonts/inter-pdf-400.ttf, -600.ttf, -700.ttf.

Quelle: Inter 4.1 (npm-Paket inter-ui@4.1.1, Datei variable/InterVariable.woff2, SIL Open Font License).
Aus der variablen Schrift werden feste Schnitte (Regular, SemiBold, Bold) erzeugt und auf die Zeichen
reduziert, die auf Rechnungen vorkommen: Latin-1, Latin Extended-A (ş, ğ, ı, ő, ł …), Anführungszeichen,
Striche, € – rund 24 KB je Schnitt. Ohne Hinting und Layout-Tabellen, die der PDF-Schreiber nicht nutzt.

Aufruf:  pip install fonttools brotli
         npm pack inter-ui@4.1.1 && tar xzf inter-ui-4.1.1.tgz
         python3 scripts/build-pdf-fonts.py package/variable/InterVariable.woff2
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

UNICODES = (
    list(range(0x20, 0x7F)) + list(range(0xA0, 0x180)) + list(range(0x218, 0x21C))
    + [0x2C6, 0x2DC, 0x2009, 0x202F, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2018, 0x2019, 0x201A,
       0x201C, 0x201D, 0x201E, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203A, 0x20AC, 0x2116, 0x2122, 0x2212]
)

def build(source, weight):
    font = instantiateVariableFont(TTFont(source), {'wght': weight, 'opsz': 14})
    opts = subset.Options()
    opts.hinting = False
    opts.layout_features = []
    opts.notdef_outline = True
    opts.name_IDs = ['*']
    opts.drop_tables += ['GSUB', 'GPOS', 'GDEF', 'STAT', 'DSIG', 'kern']
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=UNICODES)
    sub.subset(font)
    font.flavor = None
    font.save(f'fonts/inter-pdf-{weight}.ttf')

if __name__ == '__main__':
    for w in (400, 600, 700):
        build(sys.argv[1], w)
        print(f'fonts/inter-pdf-{w}.ttf')
