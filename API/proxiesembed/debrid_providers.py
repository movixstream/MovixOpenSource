"""Liste des débrideurs présentés par l'interface Movix."""

DEBRID_PROVIDERS = ('deepbrid', 'realdebrid', 'debridr')
DEFAULT_DEBRID_PROVIDERS = 'deepbrid'


def get_enabled_debrid_providers(value):
    """Une liste vide désactive tout ; les noms inconnus ne sont jamais exposés."""
    if value is None:
        value = DEFAULT_DEBRID_PROVIDERS
    names = [name.strip().lower().replace('-', '') for name in value.split(',')]
    return list(dict.fromkeys(name for name in names if name in DEBRID_PROVIDERS))
