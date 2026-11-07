/* How a teacher's name is shown everywhere: "Resp" + first and last name + "Sir", or "Resp Miss" + name for a
   sister. Only the display: the record keeps the plain name, which follows the student record. */
export const teacherTitle = t => t.g === 'F' ? 'Resp Miss ' + t.name : 'Resp ' + t.name + ' Sir';
