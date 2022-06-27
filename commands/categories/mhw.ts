import Command from '../../bot/command';

export default class Mhw extends Command {
  public constructor() {
    super(
      'mhw',
      'Monster Hunter World: Iceborne',
      ['[command] [arguments]'],
      { category: true }
    );
  }
}