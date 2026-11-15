type MarginProperty = 'margin-top' | 'margin-right' | 'margin-bottom' | 'margin-left';

type PhysicalSide = 'top' | 'right' | 'bottom' | 'left';

type StyledElement = Element & {
  style: CSSStyleDeclaration;
};

type InlineMarginPatch = {
  appliedPriority: string;
  appliedValue: string;
  previousPriority: string;
  previousValue: string;
};

type FlexItem = {
  domIndex: number;
  element: StyledElement | null;
  order: number;
};

type Axes = {
  blockEnd: PhysicalSide;
  blockStart: PhysicalSide;
  inlineEnd: PhysicalSide;
  inlineStart: PhysicalSide;
};

type FlexPlan = {
  additions: Map<StyledElement, Map<MarginProperty, string>>;
  container: Element;
};

type PreparedMarginWrite = {
  element: StyledElement;
  previousPriority: string;
  previousValue: string;
  property: MarginProperty;
  requestedValue: string;
};

type PreparedFlexPlan = {
  container: Element;
  transitionGuards: PreparedTransitionGuard[];
  writes: PreparedMarginWrite[];
};

type TransitionStyleProperty =
  | 'transition-property'
  | 'transition-duration'
  | 'transition-delay'
  | 'transition-timing-function';

type TransitionValues = Record<TransitionStyleProperty, string>;

type TransitionGuard = {
  baseValues: TransitionValues;
  guardedMargins: MarginProperty[];
  owner: Element;
  patches: Map<TransitionStyleProperty, InlineMarginPatch>;
};

type PreparedTransitionGuard = {
  baseValues: TransitionValues;
  element: StyledElement;
  guardedMargins: MarginProperty[];
  owner: Element;
  values: TransitionValues;
};

type ContainerPatchSnapshot = Map<StyledElement, Map<MarginProperty, string>>;

type TypedStyleMapLike = {
  get(property: string): unknown;
};

type ElementWithTypedStyleMap = Element & {
  computedStyleMap?: () => TypedStyleMapLike;
};

export const FLEX_GAP_UPDATED_EVENT = 'movix:flex-gap-updated';

export type FlexGapUpdatedEventDetail = {
  containers: Element[];
};

export function getFlexGapLayoutRevision(): number {
  return layoutRevision;
}

const trackedContainers = new Set<Element>();
const containerItems = new Map<Element, Set<StyledElement>>();
const inlinePatches = new Map<StyledElement, Map<MarginProperty, InlineMarginPatch>>();
const transitionGuards = new Map<StyledElement, TransitionGuard>();
const pendingRoots = new Set<Element>();
const pendingContainers = new Set<Element>();

let observer: MutationObserver | null = null;
let animationFrameId: number | null = null;
let fullScanPending = false;
let layoutRevision = 0;
let started = false;

const marginProperty = (side: PhysicalSide): MarginProperty => `margin-${side}`;

const isStyledElement = (element: Element): element is StyledElement =>
  'style' in element && element.style instanceof CSSStyleDeclaration;

const hasRenderableText = (node: Text, whiteSpace: string): boolean => {
  const value = node.data;
  if (!value) return false;

  if (whiteSpace === 'pre' || whiteSpace === 'pre-wrap' || whiteSpace === 'break-spaces') {
    return true;
  }

  // NBSP et les autres espaces non sécables produisent bien une boîte anonyme.
  return /[^\t\n\f\r ]/.test(value);
};

const readAxes = (style: CSSStyleDeclaration): Axes => {
  const direction = style.direction === 'rtl' ? 'rtl' : 'ltr';
  const writingMode = style.writingMode || 'horizontal-tb';

  if (writingMode.startsWith('vertical') || writingMode.startsWith('sideways')) {
    const inlineStart: PhysicalSide = direction === 'rtl' ? 'bottom' : 'top';
    const inlineEnd: PhysicalSide = direction === 'rtl' ? 'top' : 'bottom';
    const blockStartsRight = writingMode.endsWith('-rl');

    return {
      inlineStart,
      inlineEnd,
      blockStart: blockStartsRight ? 'right' : 'left',
      blockEnd: blockStartsRight ? 'left' : 'right',
    };
  }

  return {
    inlineStart: direction === 'rtl' ? 'right' : 'left',
    inlineEnd: direction === 'rtl' ? 'left' : 'right',
    blockStart: 'top',
    blockEnd: 'bottom',
  };
};

const isUsableGap = (value: string | null | undefined): value is string => {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'normal' || normalized === 'initial' || normalized === 'unset') {
    return false;
  }

  const numericValue = Number.parseFloat(normalized);
  if (Number.isFinite(numericValue) && numericValue === 0) return false;

  return typeof CSS === 'undefined'
    || typeof CSS.supports !== 'function'
    || CSS.supports('margin-left', `calc(0px + ${value})`);
};

const hasRenderedPseudoItem = (element: Element, pseudo: '::before' | '::after'): boolean => {
  try {
    const style = getComputedStyle(element, pseudo);
    const content = style.content;
    return style.display !== 'none'
      && style.position !== 'absolute'
      && style.position !== 'fixed'
      && content !== 'none'
      && content !== 'normal';
  } catch {
    return false;
  }
};

const tailwindUtility = (token: string): string => {
  const lastVariantSeparator = token.lastIndexOf(':');
  return token.slice(lastVariantSeparator + 1).replace(/^!/, '');
};

const hasTailwindAutoMargin = (
  element: Element,
  property: MarginProperty,
  axes: Axes,
): boolean => {
  const side = property.slice('margin-'.length) as PhysicalSide;
  const physicalUtilities: Record<PhysicalSide, string> = {
    top: 'mt-auto',
    right: 'mr-auto',
    bottom: 'mb-auto',
    left: 'ml-auto',
  };

  for (const token of element.classList) {
    const utility = tailwindUtility(token);
    if (utility === 'm-auto' || utility === physicalUtilities[side]) return true;
    if ((side === 'left' || side === 'right') && utility === 'mx-auto') return true;
    if ((side === 'top' || side === 'bottom') && utility === 'my-auto') return true;
    if (side === axes.inlineStart && utility === 'ms-auto') return true;
    if (side === axes.inlineEnd && utility === 'me-auto') return true;
    if (utility.includes(`[${property}:auto]`)) return true;
  }

  return false;
};

const isAutoMargin = (
  element: StyledElement,
  property: MarginProperty,
  axes: Axes,
): boolean => {
  const typedElement = element as ElementWithTypedStyleMap;

  try {
    const typedStyleMap = typedElement.computedStyleMap?.();
    const typedValue = typedStyleMap?.get(property);
    if (typedValue) return String(typedValue).trim().toLowerCase() === 'auto';
  } catch {
    // Certaines implémentations partielles de Typed OM lèvent sur les SVG.
  }

  const inlineValue = element.style.getPropertyValue(property).trim().toLowerCase();
  if (inlineValue === 'auto') return true;

  return hasTailwindAutoMargin(element, property, axes);
};

const restorePatch = (element: StyledElement, property: MarginProperty): boolean => {
  const elementPatches = inlinePatches.get(element);
  const patch = elementPatches?.get(property);
  if (!patch) return false;

  const currentValue = element.style.getPropertyValue(property);
  const currentPriority = element.style.getPropertyPriority(property);
  let restored = false;

  // React ou un autre script a pu reprendre la main depuis notre écriture.
  if (currentValue === patch.appliedValue && currentPriority === patch.appliedPriority) {
    if (patch.previousValue) {
      element.style.setProperty(property, patch.previousValue, patch.previousPriority);
    } else {
      element.style.removeProperty(property);
    }
    restored = true;
  }

  elementPatches?.delete(property);
  if (elementPatches?.size === 0) inlinePatches.delete(element);
  return restored;
};

const restoreContainer = (container: Element): boolean => {
  let restored = false;
  const items = containerItems.get(container);
  if (items) {
    for (const item of items) {
      const properties = inlinePatches.get(item);
      if (!properties) continue;
      for (const property of [...properties.keys()]) {
        restored = restorePatch(item, property) || restored;
      }
    }
  }

  containerItems.delete(container);
  trackedContainers.delete(container);
  return restored;
};

const restoreAll = (): void => {
  for (const container of [...trackedContainers]) restoreContainer(container);

  // Filet de sécurité pour un nœud dont le propriétaire aurait été retiré.
  for (const [element, properties] of [...inlinePatches]) {
    for (const property of [...properties.keys()]) restorePatch(element, property);
  }

  for (const [element, guard] of [...transitionGuards]) {
    if (element.isConnected) {
      const style = getComputedStyle(element);
      for (const property of guard.guardedMargins) style.getPropertyValue(property);
    }
    restoreTransitionGuard(element);
  }
};

const transitionStyleProperties: TransitionStyleProperty[] = [
  'transition-property',
  'transition-duration',
  'transition-delay',
  'transition-timing-function',
];

const splitCssList = (value: string): string[] => {
  const entries: string[] = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
    else if (character === ',' && depth === 0) {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  entries.push(value.slice(start).trim());
  return entries.filter(Boolean);
};

const expandCssList = (entries: string[], length: number, fallback: string): string[] => {
  const source = entries.length > 0 ? entries : [fallback];
  return Array.from({ length }, (_, index) => source[index % source.length]);
};

const readTransitionValues = (style: CSSStyleDeclaration): TransitionValues => ({
  'transition-property': style.transitionProperty || 'all',
  'transition-duration': style.transitionDuration || '0s',
  'transition-delay': style.transitionDelay || '0s',
  'transition-timing-function': style.transitionTimingFunction || 'ease',
});

const buildGuardedTransitionValues = (
  baseValues: TransitionValues,
  guardedMargins: MarginProperty[],
): TransitionValues => {
  const originalProperties = splitCssList(baseValues['transition-property']);
  const keepsOriginalTransitions = !(originalProperties.length === 1 && originalProperties[0] === 'none');
  const propertyCount = originalProperties.length || 1;
  const properties = keepsOriginalTransitions ? originalProperties : [];
  const durations = keepsOriginalTransitions
    ? expandCssList(splitCssList(baseValues['transition-duration']), propertyCount, '0s')
    : [];
  const delays = keepsOriginalTransitions
    ? expandCssList(splitCssList(baseValues['transition-delay']), propertyCount, '0s')
    : [];
  const timingFunctions = keepsOriginalTransitions
    ? expandCssList(splitCssList(baseValues['transition-timing-function']), propertyCount, 'ease')
    : [];

  return {
    'transition-property': [...properties, ...guardedMargins].join(', '),
    'transition-duration': [...durations, ...guardedMargins.map(() => '0s')].join(', '),
    'transition-delay': [...delays, ...guardedMargins.map(() => '0s')].join(', '),
    'transition-timing-function': [...timingFunctions, ...guardedMargins.map(() => 'linear')].join(', '),
  };
};

const cssTimeIsPositive = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount)) return false;
  if (normalized.endsWith('ms')) return amount > 0;
  if (normalized.endsWith('s')) return amount > 0;
  return false;
};

const transitionPropertyCoversMargin = (
  transitionProperty: string,
  margin: MarginProperty,
  axes: Axes,
): boolean => {
  const property = transitionProperty.trim().toLowerCase();
  if (property === 'all' || property === 'margin' || property === margin) return true;

  const side = margin.slice('margin-'.length) as PhysicalSide;
  if (property === 'margin-inline') {
    return side === axes.inlineStart || side === axes.inlineEnd;
  }
  if (property === 'margin-block') {
    return side === axes.blockStart || side === axes.blockEnd;
  }
  if (property === 'margin-inline-start') return side === axes.inlineStart;
  if (property === 'margin-inline-end') return side === axes.inlineEnd;
  if (property === 'margin-block-start') return side === axes.blockStart;
  if (property === 'margin-block-end') return side === axes.blockEnd;
  return false;
};

const transitionValuesNeedGuard = (
  values: TransitionValues,
  margins: MarginProperty[],
  axes: Axes,
): boolean => {
  const properties = splitCssList(values['transition-property']);
  if (properties.length === 0 || (properties.length === 1 && properties[0] === 'none')) return false;

  const durations = expandCssList(
    splitCssList(values['transition-duration']),
    properties.length,
    '0s',
  );
  const delays = expandCssList(
    splitCssList(values['transition-delay']),
    properties.length,
    '0s',
  );

  return margins.some((margin) => {
    let matchingIndex = -1;
    for (let index = 0; index < properties.length; index += 1) {
      if (transitionPropertyCoversMargin(properties[index], margin, axes)) matchingIndex = index;
    }
    return matchingIndex >= 0
      && (cssTimeIsPositive(durations[matchingIndex]) || cssTimeIsPositive(delays[matchingIndex]));
  });
};

const transitionPatchStillOwned = (
  element: StyledElement,
  property: TransitionStyleProperty,
  patch: InlineMarginPatch,
): boolean => element.style.getPropertyValue(property) === patch.appliedValue
  && element.style.getPropertyPriority(property) === patch.appliedPriority;

function restoreTransitionGuard(element: StyledElement): void {
  const guard = transitionGuards.get(element);
  if (!guard) return;

  for (const [property, patch] of guard.patches) {
    if (!transitionPatchStillOwned(element, property, patch)) continue;
    if (patch.previousValue) {
      element.style.setProperty(property, patch.previousValue, patch.previousPriority);
    } else {
      element.style.removeProperty(property);
    }
  }
  transitionGuards.delete(element);
}

const applyTransitionGuard = (prepared: PreparedTransitionGuard): void => {
  const existing = transitionGuards.get(prepared.element);
  const patches = existing?.patches || new Map<TransitionStyleProperty, InlineMarginPatch>();

  for (const property of transitionStyleProperties) {
    const previousPatch = patches.get(property);
    const previousValue = previousPatch?.previousValue
      ?? prepared.element.style.getPropertyValue(property);
    const previousPriority = previousPatch?.previousPriority
      ?? prepared.element.style.getPropertyPriority(property);

    prepared.element.style.setProperty(property, prepared.values[property], 'important');
    patches.set(property, {
      previousValue,
      previousPriority,
      appliedValue: prepared.element.style.getPropertyValue(property),
      appliedPriority: prepared.element.style.getPropertyPriority(property),
    });
  }

  transitionGuards.set(prepared.element, {
    baseValues: prepared.baseValues,
    guardedMargins: prepared.guardedMargins,
    owner: prepared.owner,
    patches,
  });
};

const refreshTransitionGuards = (containers: Set<Element>): void => {
  const guardsToRefresh = [...transitionGuards]
    .filter(([, guard]) => containers.has(guard.owner))
    .map(([element, guard]) => ({
      element,
      guardedMargins: guard.guardedMargins,
      owner: guard.owner,
    }));

  // La marge reste stable pendant que les déclarations auteur redeviennent lisibles.
  for (const guard of guardsToRefresh) restoreTransitionGuard(guard.element);

  const refreshedGuards: PreparedTransitionGuard[] = [];
  for (const guard of guardsToRefresh) {
    if (!guard.element.isConnected) continue;
    const style = getComputedStyle(guard.element);
    const baseValues = readTransitionValues(style);
    if (!transitionValuesNeedGuard(baseValues, guard.guardedMargins, readAxes(style))) continue;
    refreshedGuards.push({
      ...guard,
      baseValues,
      values: buildGuardedTransitionValues(baseValues, guard.guardedMargins),
    });
  }

  // Les exclusions sont remises avant toute restauration de marge.
  for (const guard of refreshedGuards) applyTransitionGuard(guard);
};

const guardNewlyActiveMarginTransitions = (containers: Set<Element>): void => {
  const preparedGuards: PreparedTransitionGuard[] = [];

  for (const container of containers) {
    const items = containerItems.get(container);
    if (!items) continue;

    for (const element of items) {
      if (transitionGuards.has(element)) continue;
      const patches = inlinePatches.get(element);
      if (!patches) continue;

      const guardedMargins = [...patches.keys()];
      const style = getComputedStyle(element);
      const baseValues = readTransitionValues(style);
      if (!transitionValuesNeedGuard(baseValues, guardedMargins, readAxes(style))) continue;

      preparedGuards.push({
        baseValues,
        element,
        guardedMargins,
        owner: container,
        values: buildGuardedTransitionValues(baseValues, guardedMargins),
      });
    }
  }

  for (const guard of preparedGuards) applyTransitionGuard(guard);
};

const snapshotContainerPatches = (container: Element): ContainerPatchSnapshot => {
  const snapshot: ContainerPatchSnapshot = new Map();
  const items = containerItems.get(container);
  if (!items) return snapshot;

  for (const item of items) {
    const properties = inlinePatches.get(item);
    if (!properties) continue;

    const itemSnapshot = new Map<MarginProperty, string>();
    for (const [property, patch] of properties) {
      const currentValue = item.style.getPropertyValue(property);
      const currentPriority = item.style.getPropertyPriority(property);
      if (currentValue !== patch.appliedValue || currentPriority !== patch.appliedPriority) continue;
      itemSnapshot.set(property, `${currentValue}!${currentPriority}`);
    }
    if (itemSnapshot.size > 0) snapshot.set(item, itemSnapshot);
  }

  return snapshot;
};

const patchSnapshotsEqual = (
  first: ContainerPatchSnapshot,
  second: ContainerPatchSnapshot,
): boolean => {
  if (first.size !== second.size) return false;

  for (const [element, firstProperties] of first) {
    const secondProperties = second.get(element);
    if (!secondProperties || firstProperties.size !== secondProperties.size) return false;
    for (const [property, value] of firstProperties) {
      if (secondProperties.get(property) !== value) return false;
    }
  }

  return true;
};

const addMargin = (
  additions: FlexPlan['additions'],
  element: StyledElement,
  property: MarginProperty,
  gap: string,
): void => {
  let elementAdditions = additions.get(element);
  if (!elementAdditions) {
    elementAdditions = new Map();
    additions.set(element, elementAdditions);
  }

  const previousGap = elementAdditions.get(property);
  elementAdditions.set(property, previousGap ? `calc(${previousGap} + ${gap})` : gap);
};

const assignGapBetween = (
  additions: FlexPlan['additions'],
  first: FlexItem,
  second: FlexItem,
  firstProperty: MarginProperty,
  secondProperty: MarginProperty,
  gap: string,
  axes: Axes,
): void => {
  if (first.element && !isAutoMargin(first.element, firstProperty, axes)) {
    addMargin(additions, first.element, firstProperty, gap);
    return;
  }

  if (second.element && !isAutoMargin(second.element, secondProperty, axes)) {
    addMargin(additions, second.element, secondProperty, gap);
  }
};

const buildFlexPlan = (container: Element): FlexPlan | null => {
  const containerStyle = getComputedStyle(container);
  if (containerStyle.display !== 'flex' && containerStyle.display !== 'inline-flex') return null;

  const rowGap = containerStyle.rowGap;
  const columnGap = containerStyle.columnGap;
  if (!isUsableGap(rowGap) && !isUsableGap(columnGap)) return null;

  // Les pseudo-éléments sont de vrais flex-items, mais ne peuvent recevoir de patch inline.
  if (hasRenderedPseudoItem(container, '::before') || hasRenderedPseudoItem(container, '::after')) {
    return null;
  }

  const axes = readAxes(containerStyle);
  const direction = containerStyle.flexDirection;
  const isRow = direction === 'row' || direction === 'row-reverse';
  const isReverse = direction === 'row-reverse' || direction === 'column-reverse';
  const wrap = containerStyle.flexWrap;
  const isWrapped = wrap === 'wrap' || wrap === 'wrap-reverse';

  let mainStart = isRow ? axes.inlineStart : axes.blockStart;
  let mainEnd = isRow ? axes.inlineEnd : axes.blockEnd;
  if (isReverse) [mainStart, mainEnd] = [mainEnd, mainStart];

  let crossStart = isRow ? axes.blockStart : axes.inlineStart;
  let crossEnd = isRow ? axes.blockEnd : axes.inlineEnd;
  if (wrap === 'wrap-reverse') [crossStart, crossEnd] = [crossEnd, crossStart];

  const mainGap = isRow ? columnGap : rowGap;
  const crossGap = isRow ? rowGap : columnGap;
  const items: FlexItem[] = [];
  let containsDisplayContents = false;

  [...container.childNodes].forEach((node, domIndex) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      if (!hasRenderableText(text, containerStyle.whiteSpace)) return;

      // Les séquences de texte contiguës forment un seul flex-item anonyme.
      const previousItem = items[items.length - 1];
      if (previousItem?.element === null && previousItem.order === 0) return;
      items.push({ domIndex, element: null, order: 0 });
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const style = getComputedStyle(element);

    if (style.display === 'none' || style.position === 'absolute' || style.position === 'fixed') {
      return;
    }

    // Sans reparentage, patcher display:contents viserait une boîte inexistante.
    if (style.display === 'contents') {
      containsDisplayContents = true;
      return;
    }

    if (!isStyledElement(element)) return;
    const order = Number.parseInt(style.order, 10);
    items.push({
      domIndex,
      element,
      order: Number.isFinite(order) ? order : 0,
    });
  });

  if (containsDisplayContents || items.length < 2) return null;

  items.sort((first, second) => first.order - second.order || first.domIndex - second.domIndex);

  const additions: FlexPlan['additions'] = new Map();
  if (isUsableGap(mainGap)) {
    const endProperty = marginProperty(mainEnd);
    const startProperty = marginProperty(mainStart);

    for (let index = 0; index < items.length - 1; index += 1) {
      assignGapBetween(
        additions,
        items[index],
        items[index + 1],
        endProperty,
        startProperty,
        mainGap,
        axes,
      );
    }
  }

  if (isWrapped && isUsableGap(crossGap)) {
    const crossEndProperty = marginProperty(crossEnd);
    const crossStartProperty = marginProperty(crossStart);

    for (const item of items) {
      if (!item.element) continue;
      if (!isAutoMargin(item.element, crossEndProperty, axes)) {
        addMargin(additions, item.element, crossEndProperty, crossGap);
      } else if (!isAutoMargin(item.element, crossStartProperty, axes)) {
        addMargin(additions, item.element, crossStartProperty, crossGap);
      }
    }
  }

  if (additions.size === 0) return null;
  return { additions, container };
};

const preparePlan = (plan: FlexPlan): PreparedFlexPlan => {
  const writes: PreparedMarginWrite[] = [];
  const transitionGuardsForPlan: PreparedTransitionGuard[] = [];

  for (const [element, additions] of plan.additions) {
    const computedStyle = getComputedStyle(element);
    const elementWrites: PreparedMarginWrite[] = [];
    for (const [property, gap] of additions) {
      const baseMargin = computedStyle.getPropertyValue(property).trim() || '0px';
      if (baseMargin.toLowerCase() === 'auto') continue;

      elementWrites.push({
        element,
        property,
        previousValue: element.style.getPropertyValue(property),
        previousPriority: element.style.getPropertyPriority(property),
        requestedValue: `calc(${baseMargin} + ${gap})`,
      });
    }

    if (elementWrites.length === 0) continue;
    writes.push(...elementWrites);

    const existingGuard = transitionGuards.get(element);
    const baseValues = existingGuard?.baseValues || readTransitionValues(computedStyle);
    const guardedMargins = [...new Set(elementWrites.map((write) => write.property))];
    if (!transitionValuesNeedGuard(baseValues, guardedMargins, readAxes(computedStyle))) continue;
    transitionGuardsForPlan.push({
      baseValues,
      element,
      guardedMargins,
      owner: plan.container,
      values: buildGuardedTransitionValues(baseValues, guardedMargins),
    });
  }

  return { container: plan.container, transitionGuards: transitionGuardsForPlan, writes };
};

const applyPlan = (plan: PreparedFlexPlan): boolean => {
  const patchedItems = new Set<StyledElement>();

  for (const write of plan.writes) {
    const { element, previousPriority, previousValue, property, requestedValue } = write;
    let elementPatches = inlinePatches.get(element);
    if (!elementPatches) {
      elementPatches = new Map();
      inlinePatches.set(element, elementPatches);
    }

    element.style.setProperty(property, requestedValue, 'important');
    elementPatches.set(property, {
      previousValue,
      previousPriority,
      appliedValue: element.style.getPropertyValue(property),
      appliedPriority: element.style.getPropertyPriority(property),
    });

    patchedItems.add(element);
  }

  if (patchedItems.size > 0) {
    trackedContainers.add(plan.container);
    containerItems.set(plan.container, patchedItems);
  }
  return patchedItems.size > 0;
};

const addCandidateAncestors = (element: Element, candidates: Set<Element>): void => {
  let current: Element | null = element;
  while (current) {
    if (trackedContainers.has(current)) {
      candidates.add(current);
    } else {
      const display = getComputedStyle(current).display;
      if (display === 'flex' || display === 'inline-flex') candidates.add(current);
    }
    current = current.parentElement;
  }
};

const addCandidateSubtree = (root: Element, candidates: Set<Element>): void => {
  const visit = (element: Element): void => {
    if (trackedContainers.has(element)) {
      candidates.add(element);
      return;
    }

    const display = getComputedStyle(element).display;
    if (display === 'flex' || display === 'inline-flex') candidates.add(element);
  };

  visit(root);
  for (const element of root.querySelectorAll('*')) visit(element);
};

const flush = (): void => {
  animationFrameId = null;
  if (!started) return;

  const candidates = new Set<Element>(pendingContainers);
  pendingContainers.clear();

  if (fullScanPending) {
    fullScanPending = false;
    const root = document.body || document.documentElement;
    addCandidateSubtree(root, candidates);
    for (const container of trackedContainers) candidates.add(container);
  } else {
    for (const root of pendingRoots) {
      addCandidateSubtree(root, candidates);
      addCandidateAncestors(root, candidates);
    }
  }
  pendingRoots.clear();

  for (const container of [...trackedContainers]) {
    if (!container.isConnected) candidates.add(container);
  }

  const previousSnapshots = new Map<Element, ContainerPatchSnapshot>();
  for (const container of candidates) {
    previousSnapshots.set(container, snapshotContainerPatches(container));
  }

  // Toutes les restaurations précèdent toutes les lectures, qui précèdent les écritures.
  refreshTransitionGuards(candidates);
  guardNewlyActiveMarginTransitions(candidates);
  observer?.takeRecords();
  for (const container of candidates) restoreContainer(container);
  observer?.takeRecords();

  const plans: FlexPlan[] = [];
  for (const container of candidates) {
    if (!container.isConnected) continue;
    const plan = buildFlexPlan(container);
    if (plan) plans.push(plan);
  }

  const preparedPlans = plans.map(preparePlan);
  const desiredGuardElements = new Set<StyledElement>();
  for (const plan of preparedPlans) {
    for (const guard of plan.transitionGuards) desiredGuardElements.add(guard.element);
  }
  const obsoleteGuardElements: StyledElement[] = [];
  for (const [element, guard] of transitionGuards) {
    if (!candidates.has(guard.owner) || desiredGuardElements.has(element)) continue;
    if (element.isConnected) {
      const style = getComputedStyle(element);
      for (const property of guard.guardedMargins) style.getPropertyValue(property);
    }
    obsoleteGuardElements.push(element);
  }

  for (const element of obsoleteGuardElements) restoreTransitionGuard(element);
  for (const plan of preparedPlans) {
    for (const guard of plan.transitionGuards) applyTransitionGuard(guard);
  }
  for (const plan of preparedPlans) applyPlan(plan);
  observer?.takeRecords();

  const changedContainers = [...candidates].filter((container) =>
    container.isConnected
    && !patchSnapshotsEqual(
      previousSnapshots.get(container) || new Map(),
      snapshotContainerPatches(container),
    ));

  if (changedContainers.length > 0) {
    layoutRevision += 1;
    window.dispatchEvent(new CustomEvent<FlexGapUpdatedEventDetail>(FLEX_GAP_UPDATED_EVENT, {
      detail: { containers: changedContainers },
    }));
  }
};

const scheduleFlush = (): void => {
  if (!started || animationFrameId !== null) return;
  animationFrameId = window.requestAnimationFrame(flush);
};

const queueRoot = (element: Element): void => {
  if (element === document.documentElement) {
    fullScanPending = true;
    pendingRoots.clear();
  } else if (!fullScanPending) {
    pendingRoots.add(element);
  }
  scheduleFlush();
};

const queueContainerAncestors = (element: Element): void => {
  let current: Element | null = element;
  while (current) {
    pendingContainers.add(current);
    current = current.parentElement;
  }
  scheduleFlush();
};

const queueFullScan = (): void => {
  fullScanPending = true;
  pendingRoots.clear();
  scheduleFlush();
};

const layoutStyleProperties = new Set([
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'box-sizing',
  'gap',
  'row-gap',
  'column-gap',
  'flex',
  'flex-basis',
  'flex-grow',
  'flex-shrink',
  'flex-flow',
  'flex-direction',
  'flex-wrap',
  'order',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'margin-inline',
  'margin-inline-start',
  'margin-inline-end',
  'margin-block',
  'margin-block-start',
  'margin-block-end',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border',
  'border-width',
  'font',
  'font-size',
  'line-height',
  'white-space',
  'writing-mode',
  'direction',
  'content',
  'transition',
  'transition-property',
  'transition-duration',
  'transition-delay',
  'transition-timing-function',
]);

const readRelevantInlineStyle = (cssText: string | null): Map<string, string> => {
  const values = new Map<string, string>();
  const scratch = document.createElement('div').style;
  scratch.cssText = cssText || '';

  for (let index = 0; index < scratch.length; index += 1) {
    const property = scratch.item(index);
    if (!layoutStyleProperties.has(property) && !property.startsWith('--')) continue;
    values.set(property, `${scratch.getPropertyValue(property)}!${scratch.getPropertyPriority(property)}`);
  }

  return values;
};

const hasRelevantStyleMutation = (record: MutationRecord): boolean => {
  const target = record.target;
  if (!(target instanceof Element)) return false;

  const before = readRelevantInlineStyle(record.oldValue);
  const after = readRelevantInlineStyle(target.getAttribute('style'));
  if (before.size !== after.size) return true;
  for (const [property, value] of before) {
    if (after.get(property) !== value) return true;
  }
  return false;
};

const queueRemovedContainers = (node: Node): void => {
  if (!(node instanceof Element)) return;
  for (const container of trackedContainers) {
    if (container === node || node.contains(container)) pendingContainers.add(container);
  }
};

const handleMutations = (records: MutationRecord[]): void => {
  for (const record of records) {
    if (record.type === 'characterData') {
      const parent = record.target.parentElement;
      if (!parent) continue;
      if (parent.closest('head')) queueFullScan();
      else queueContainerAncestors(parent);
      continue;
    }

    if (!(record.target instanceof Element)) continue;

    if (record.type === 'childList') {
      if (record.target.closest('head')) {
        queueFullScan();
        continue;
      }

      queueContainerAncestors(record.target);
      for (const node of record.addedNodes) {
        if (node instanceof Element) queueRoot(node);
      }
      for (const node of record.removedNodes) queueRemovedContainers(node);
      continue;
    }

    if (record.attributeName === 'style' && !hasRelevantStyleMutation(record)) continue;
    queueRoot(record.target);
  }

  if (pendingContainers.size > 0) scheduleFlush();
};

const handleResize = (): void => {
  queueFullScan();
};

const handleStylesheetLoad = (event: Event): void => {
  const target = event.target;
  if (!(target instanceof HTMLLinkElement)) return;
  if (target.rel.toLowerCase().split(/\s+/).includes('stylesheet')) queueFullScan();
};

const startFallback = (): void => {
  if (started) return;
  started = true;

  observer = new MutationObserver(handleMutations);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeOldValue: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  window.addEventListener('resize', handleResize, { passive: true });
  document.addEventListener('load', handleStylesheetLoad, true);

  fullScanPending = true;
  scheduleFlush();
};

const stopFallback = (): void => {
  started = false;
  if (animationFrameId !== null) {
    window.cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  observer?.disconnect();
  observer = null;
  window.removeEventListener('resize', handleResize);
  document.removeEventListener('load', handleStylesheetLoad, true);

  pendingRoots.clear();
  pendingContainers.clear();
  fullScanPending = false;
  restoreAll();
};

/**
 * Arrête le repli et restitue les styles inline qui lui appartiennent encore.
 */
export function cleanupFlexGapSupport(): void {
  stopFallback();
  document.documentElement.classList.remove('no-flex-gap');
}

/**
 * Certaines WebView Android embarquées acceptent gap en Grid, mais l'ignorent
 * en Flexbox. CSS.supports('gap', '1px') et l'User-Agent figé de l'APK ne
 * permettent donc pas de décider si les espacements ont besoin d'un repli.
 *
 * Le repli ne mesure aucune ligne et ne change pas la géométrie du conteneur.
 * En wrap, la marge entre deux items peut rester en fin de ligne : cette petite
 * gouttière extérieure est volontaire sur les seuls moteurs anciens concernés.
 */
export function initFlexGapSupport(): void {
  stopFallback();

  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;display:flex;flex-direction:column;row-gap:1px;padding:0;border:0;';

  for (let index = 0; index < 2; index += 1) {
    const item = document.createElement('div');
    item.style.cssText = 'height:0;min-height:0;padding:0;margin:0;border:0;';
    probe.appendChild(item);
  }

  const probeHost = document.body || document.documentElement;
  probeHost.appendChild(probe);
  const supported = probe.scrollHeight === 1;
  probe.remove();
  document.documentElement.classList.toggle('no-flex-gap', !supported);

  if (supported) return;
  startFallback();
}
