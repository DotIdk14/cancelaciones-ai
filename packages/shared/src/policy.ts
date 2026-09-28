/**
 * Referencias a la fuente normativa del propietario. El manifiesto se sella con
 * el hash y el tamaño del PDF original: sin ese sello, cualquier sección podría
 * haber sido editada sin que nadie lo note, y POLICY_IS_IMMUTABLE deja de
 * sostenerse.
 */
export interface PolicySectionRef {
  id: string;
  title: string;
  pages: number[];
  file: string;
  chars: number;
}

export interface PolicyManifest {
  code: string;
  title: string;
  version: string;
  publishedAt: string;
  sourceFile: string;
  sourceSha256: string;
  sourceBytes: number;
  pageCount: number;
  sections: PolicySectionRef[];
}

/** Coincidencia de búsqueda sobre las secciones normativas. `score` es del buscador, no una confianza del dictamen. */
export interface PolicySearchHit {
  section: string;
  title: string;
  page: number | null;
  snippet: string;
  score: number;
}
